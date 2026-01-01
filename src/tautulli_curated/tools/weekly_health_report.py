from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from email.message import EmailMessage
from html import escape as _html_escape
from pathlib import Path
import smtplib

from tautulli_curated.helpers.logger import setup_logger
from tautulli_curated.helpers.log_health import collect_log_events, summarize_events, write_health_outputs


logger = setup_logger("weekly_health_report")


def _default_base_dir() -> Path:
    # tools/ -> tautulli_curated/ -> src/ -> project root
    return Path(__file__).resolve().parents[3]


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Generate weekly log health JSON (and optionally email it).")
    p.add_argument("--since-days", type=int, default=7, help="How many days back to scan logs (default: 7)")
    p.add_argument("--logs-dir", type=str, default="", help="Override logs dir (default: <project>/data/logs)")
    p.add_argument("--out-dir", type=str, default="", help="Override output dir (default: <project>/data/health)")
    p.add_argument(
        "--send-email",
        action="store_true",
        help="Send the weekly report email (requires alerts.email.* config in config.local.yaml)",
    )
    return p


def _discover_expected_scripts(base_dir: Path) -> set[str]:
    """
    Best-effort list of scripts we want to always show in reports, even if they
    had 0 runs in the scanned window.

    - Includes all `src/scripts/run_*.sh` runner scripts (minus obvious tests).
    - Includes `tautulli_main` (log prefix produced by `tautulli_immaculate_taste_collection.py`).
    """
    out: set[str] = {"tautulli_main"}
    scripts_dir = base_dir / "src" / "scripts"
    if scripts_dir.exists():
        for p in scripts_dir.glob("run_*.sh"):
            stem = p.stem  # e.g. run_radarr_monitor_confirm
            if "test" in stem.lower():
                continue
            name = stem
            if name.startswith("run_"):
                name = name[len("run_") :]
            if name:
                out.add(name)
    return out


def _format_email_body(
    *,
    since: datetime,
    until: datetime,
    summary: dict,
    events: list,
    written_paths: dict[str, Path],
) -> str:
    win = summary.get("window", {}) or {}
    per_script = summary.get("per_script", {}) or {}

    def _classify_script(s: dict) -> str:
        runs = int((s or {}).get("runs", 0) or 0)
        if runs <= 0:
            return "NO_RUNS"
        if int((s or {}).get("fail", 0) or 0) > 0:
            return "FAIL"
        if int((s or {}).get("unknown", 0) or 0) > 0:
            return "UNKNOWN"
        if int((s or {}).get("partial", 0) or 0) > 0:
            return "PARTIAL"
        return "SUCCESS"

    def _status_emoji(status: str) -> str:
        s = (status or "").upper()
        if s == "SUCCESS":
            return "✅"
        if s == "PARTIAL":
            return "⚠️"
        if s == "FAIL":
            return "❌"
        if s == "UNKNOWN":
            return "❔"
        if s in {"NO_RUNS", "NO RUNS"}:
            return "⏳"
        if s in {"SKIPPED"}:
            return "⏭️"
        if s in {"INTERRUPTED"}:
            return "🛑"
        if s in {"DEPENDENCY_FAILED"}:
            return "🧱"
        return "ℹ️"

    def _overall_health_label() -> str:
        if int(win.get("fail", 0) or 0) > 0:
            return "FAIL"
        if int(win.get("partial", 0) or 0) > 0 or int(win.get("unknown", 0) or 0) > 0:
            return "WARN"
        return "OK"

    def _health_emoji(health: str) -> str:
        h = (health or "").upper()
        if h == "OK":
            return "✅"
        if h == "WARN":
            return "⚠️"
        if h == "FAIL":
            return "❌"
        return "ℹ️"

    lines: list[str] = []
    health = _overall_health_label()
    health_icon = _health_emoji(health)

    # Build script buckets
    success_scripts: list[str] = []
    partial_scripts: list[str] = []
    fail_scripts: list[str] = []
    unknown_scripts: list[str] = []
    zero_runs: list[str] = []

    for name, s in sorted((per_script or {}).items(), key=lambda kv: kv[0]):
        cls = _classify_script(s or {})
        if cls == "NO_RUNS":
            zero_runs.append(name)
        elif cls == "SUCCESS":
            success_scripts.append(name)
        elif cls == "PARTIAL":
            partial_scripts.append(name)
        elif cls == "FAIL":
            fail_scripts.append(name)
        else:
            unknown_scripts.append(name)

    def _run_suffix(script_name: str) -> str:
        try:
            runs = int((per_script.get(script_name, {}) or {}).get("runs", 0) or 0)
        except Exception:
            runs = 0
        return f" ({runs} runs)" if runs > 1 else ""

    def _last_for(script_name: str) -> dict:
        return (per_script.get(script_name, {}) or {}).get("last", {}) or {}

    def _log_name(last: dict) -> str:
        p = str(last.get("path", "") or "")
        return Path(p).name if p else ""

    def _shorten_log_line(line: str) -> str:
        # Convert: "YYYY-mm-dd HH:MM:SS LEVEL - logger - step=... - message"
        # -> "LEVEL: message"
        try:
            parts = str(line).split(" - ", 3)
            if len(parts) == 4:
                left = parts[0]
                msg = parts[3]
                level = left.split()[-1]
                if level in {"INFO", "WARNING", "ERROR"}:
                    return f"{level}: {msg}"
        except Exception:
            pass
        return str(line).strip()

    def _compress_consecutive(lines: list[str]) -> list[str]:
        out: list[str] = []
        prev: str | None = None
        count = 0
        for line in lines:
            if prev is None:
                prev = line
                count = 1
                continue
            if line == prev:
                count += 1
                continue
            out.append(f"{prev} (x{count})" if count > 1 else prev)
            prev = line
            count = 1
        if prev is not None:
            out.append(f"{prev} (x{count})" if count > 1 else prev)
        return out

    def _extract_details(last: dict, *, max_lines: int = 4) -> list[str]:
        """
        Pull a small, human-friendly explanation from the log excerpt.
        Prefer the most recent ERROR/TRACEBACK/WARNING lines and strip noisy footers.
        """
        excerpt = list(last.get("excerpt", None) or [])
        if not excerpt:
            return []

        cleaned: list[str] = []
        for raw in excerpt:
            line = _shorten_log_line(str(raw)).strip()
            if not line:
                continue
            u = line.upper()
            # Drop boilerplate footers / markers
            if "FINAL_STATUS" in u or "FINAL_EXIT_CODE" in u:
                continue
            if "SCRIPT COMPLETED" in u:
                continue
            if " END PARTIAL" in u or u.endswith("END PARTIAL"):
                continue
            if " END OK" in u or u.endswith("END OK"):
                continue
            # Drop separator-only lines
            stripped = u.strip("= -")
            if not stripped:
                continue
            cleaned.append(line)

        if not cleaned:
            return []

        cleaned = _compress_consecutive(cleaned)

        selected_rev: list[str] = []
        seen: set[str] = set()

        def _pick(pred) -> None:
            for l in reversed(cleaned):
                if len(selected_rev) >= max_lines:
                    return
                if l in seen:
                    continue
                if pred(l):
                    selected_rev.append(l)
                    seen.add(l)

        _pick(lambda l: l.upper().startswith("ERROR:") or "TRACEBACK" in l.upper() or "EXCEPTION" in l.upper())
        _pick(lambda l: l.upper().startswith("WARNING:"))
        _pick(lambda l: True)

        selected = list(reversed(selected_rev))
        out: list[str] = []
        for l in selected:
            out.append(l if len(l) <= 180 else (l[:177] + "…"))
        return out

    # Intro
    lines.append("Hello,")
    lines.append("")
    lines.append("This is the automated health report for Plex-related background jobs.")
    lines.append("=" * 70)
    lines.append("")

    # Overall status
    lines.append("📊 OVERALL STATUS")
    lines.append(f"Status: {health_icon} {health}")
    lines.append(
        f"Report Window: {since.strftime('%Y-%m-%d %H:%M')} → {until.strftime('%Y-%m-%d %H:%M')}"
    )
    lines.append(f"Total Jobs: {win.get('runs', 0)}")
    lines.append(f"✅ Successful: {win.get('success', 0)}")
    lines.append(f"⚠️ Warnings / Partial: {win.get('partial', 0)}")
    lines.append(f"❌ Failed: {win.get('fail', 0)}")
    lines.append(f"❔ Unknown: {win.get('unknown', 0)}")
    lines.append("")
    lines.append("=" * 70)
    lines.append("")

    # Successful jobs
    lines.append("✅ SUCCESSFUL JOBS")
    if success_scripts:
        for name in success_scripts:
            lines.append(f"• {name}{_run_suffix(name)}")
    else:
        lines.append("• (none)")
    lines.append("")

    # Partial completions
    if partial_scripts:
        lines.append("⚠️ PARTIAL COMPLETIONS")
        for name in partial_scripts:
            last = _last_for(name)
            lines.append(f"• {name}")
            lines.append("  • Status: PARTIAL")
            details = _extract_details(last)
            if details:
                lines.append("  • What happened:")
                for d in details:
                    lines.append(f"    - {d}")
            ln = _log_name(last)
            if ln:
                lines.append(f"  • Log: {ln}")
            lines.append("")

    # Failed jobs
    if fail_scripts:
        lines.append("❌ FAILED JOBS")
        for name in fail_scripts:
            last = _last_for(name)
            lines.append(f"• {name}")
            lines.append("  • Status: FAIL")
            details = _extract_details(last)
            if details:
                lines.append("  • What happened:")
                for d in details:
                    lines.append(f"    - {d}")
            ln = _log_name(last)
            if ln:
                lines.append(f"  • Log: {ln}")
            lines.append("")

    # Unknown jobs
    if unknown_scripts:
        lines.append("❔ UNKNOWN JOBS")
        for name in unknown_scripts:
            last = _last_for(name)
            ln = _log_name(last)
            lines.append(f"• {name}" + (f" (log: {ln})" if ln else ""))
        lines.append("")

    lines.append("=" * 70)
    lines.append("")

    # Notes
    lines.append("📝 NOTES")
    if int(win.get("fail", 0) or 0) == 0:
        lines.append("• No critical failures detected.")
    else:
        lines.append("• ❌ Critical failures detected — review FAILED JOBS above.")
    if zero_runs:
        lines.append("• ⏳ No runs detected: " + ", ".join(zero_runs))

    # Call out scripts that had 0 runs (common cron failure signal).
    return "\n".join(lines).rstrip() + "\n"


def _format_email_body_html(
    *,
    since: datetime,
    until: datetime,
    summary: dict,
    base_title: str = "Plex Automation",
) -> str:
    win = summary.get("window", {}) or {}
    per_script = summary.get("per_script", {}) or {}

    def classify(s: dict) -> str:
        runs = int((s or {}).get("runs", 0) or 0)
        if runs <= 0:
            return "NO_RUNS"
        if int((s or {}).get("fail", 0) or 0) > 0:
            return "FAIL"
        if int((s or {}).get("unknown", 0) or 0) > 0:
            return "UNKNOWN"
        if int((s or {}).get("partial", 0) or 0) > 0:
            return "PARTIAL"
        return "SUCCESS"

    def status_emoji(status: str) -> str:
        s = (status or "").upper()
        return {"SUCCESS": "✅", "PARTIAL": "⚠️", "FAIL": "❌", "UNKNOWN": "❔", "NO_RUNS": "⏳"}.get(s, "ℹ️")

    # Overall health
    if int(win.get("fail", 0) or 0) > 0:
        health = "FAIL"
    elif int(win.get("partial", 0) or 0) > 0 or int(win.get("unknown", 0) or 0) > 0:
        health = "WARN"
    else:
        health = "OK"
    health_icon = status_emoji({"OK": "SUCCESS", "WARN": "PARTIAL", "FAIL": "FAIL"}.get(health, "UNKNOWN"))

    # Buckets
    success, partial, fail, unknown, zero = [], [], [], [], []
    for name, s in sorted((per_script or {}).items(), key=lambda kv: kv[0]):
        cls = classify(s or {})
        if cls == "NO_RUNS":
            zero.append(name)
        elif cls == "SUCCESS":
            success.append(name)
        elif cls == "PARTIAL":
            partial.append(name)
        elif cls == "FAIL":
            fail.append(name)
        else:
            unknown.append(name)

    def run_suffix(name: str) -> str:
        try:
            runs = int((per_script.get(name, {}) or {}).get("runs", 0) or 0)
        except Exception:
            runs = 0
        return f" ({runs} runs)" if runs > 1 else ""

    def last(name: str) -> dict:
        return (per_script.get(name, {}) or {}).get("last", {}) or {}

    def log_name(last_dict: dict) -> str:
        p = str(last_dict.get("path", "") or "")
        return Path(p).name if p else ""

    def shorten_log_line(line: str) -> str:
        try:
            parts = str(line).split(" - ", 3)
            if len(parts) == 4:
                left = parts[0]
                msg = parts[3]
                level = left.split()[-1]
                if level in {"INFO", "WARNING", "ERROR"}:
                    return f"{level}: {msg}"
        except Exception:
            pass
        return str(line).strip()

    def compress_consecutive(lines: list[str]) -> list[str]:
        out: list[str] = []
        prev: str | None = None
        count = 0
        for line in lines:
            if prev is None:
                prev = line
                count = 1
                continue
            if line == prev:
                count += 1
                continue
            out.append(f"{prev} (x{count})" if count > 1 else prev)
            prev = line
            count = 1
        if prev is not None:
            out.append(f"{prev} (x{count})" if count > 1 else prev)
        return out

    def extract_details(last_dict: dict, *, max_lines: int = 4) -> list[str]:
        excerpt = list(last_dict.get("excerpt", None) or [])
        if not excerpt:
            return []

        cleaned: list[str] = []
        for raw in excerpt:
            line = shorten_log_line(raw).strip()
            if not line:
                continue
            u = line.upper()
            if "FINAL_STATUS" in u or "FINAL_EXIT_CODE" in u:
                continue
            if "SCRIPT COMPLETED" in u:
                continue
            if " END PARTIAL" in u or u.endswith("END PARTIAL"):
                continue
            if " END OK" in u or u.endswith("END OK"):
                continue
            if not u.strip("= -"):
                continue
            cleaned.append(line)

        if not cleaned:
            return []
        cleaned = compress_consecutive(cleaned)

        selected_rev: list[str] = []
        seen: set[str] = set()

        def pick(pred) -> None:
            for l in reversed(cleaned):
                if len(selected_rev) >= max_lines:
                    return
                if l in seen:
                    continue
                if pred(l):
                    selected_rev.append(l)
                    seen.add(l)

        pick(lambda l: l.upper().startswith("ERROR:") or "TRACEBACK" in l.upper() or "EXCEPTION" in l.upper())
        pick(lambda l: l.upper().startswith("WARNING:"))
        pick(lambda l: True)

        selected = list(reversed(selected_rev))
        out: list[str] = []
        for l in selected:
            out.append(l if len(l) <= 180 else (l[:177] + "…"))
        return out

    def section(title: str, inner_html: str) -> str:
        return f"""
          <div style="margin:16px 0;">
            <div style="padding:10px 12px; border-radius:10px; border:1px solid #9ca3af; font-weight:700;">
              {title}
            </div>
            <div style="padding:10px 6px;">
              {inner_html}
            </div>
          </div>
        """

    overall_lines = f"""
      <div><b>Status:</b> {health_icon} {_html_escape(health)}</div>
      <div><b>Report Window:</b> {_html_escape(since.strftime('%Y-%m-%d %H:%M'))} → {_html_escape(until.strftime('%Y-%m-%d %H:%M'))}</div>
      <div><b>Total Jobs:</b> {_html_escape(str(win.get('runs', 0)))}</div>
      <div>✅ <b>Successful:</b> {_html_escape(str(win.get('success', 0)))}</div>
      <div>⚠️ <b>Warnings / Partial:</b> {_html_escape(str(win.get('partial', 0)))}</div>
      <div>❌ <b>Failed:</b> {_html_escape(str(win.get('fail', 0)))}</div>
      <div>❔ <b>Unknown:</b> {_html_escape(str(win.get('unknown', 0)))}</div>
    """

    successful_list = "<ul style='margin:0; padding-left:20px;'>" + "".join(
        f"<li>🟢 {_html_escape(n)}{_html_escape(run_suffix(n))}</li>" for n in success
    ) + "</ul>" if success else "<div>🟢 (none)</div>"

    def problem_block(names: list[str], icon: str, label: str) -> str:
        if not names:
            return ""
        items = []
        for n in names:
            l = last(n)
            ln = log_name(l)
            details = extract_details(l)
            sub = ["<ul style='margin:6px 0 10px 20px; padding-left:16px;'>"]
            sub.append(f"<li>Status: {_html_escape(label)}</li>")
            if details:
                sub.append("<li>What happened:")
                sub.append("<ul style='margin:6px 0 0 18px; padding-left:16px;'>")
                for d in details:
                    sub.append(
                        "<li><span style=\"font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace; font-size:12px;\">"
                        + _html_escape(d)
                        + "</span></li>"
                    )
                sub.append("</ul></li>")
            if ln:
                sub.append(f"<li>Log: {_html_escape(ln)}</li>")
            sub.append("</ul>")
            items.append(f"<li>{icon} <b>{_html_escape(n)}</b>{''.join(sub)}</li>")
        return "<ul style='margin:0; padding-left:20px;'>" + "".join(items) + "</ul>"

    partial_block = problem_block(partial, "🟡", "PARTIAL")
    fail_block = problem_block(fail, "🔴", "FAIL")
    unknown_block = problem_block(unknown, "⚪️", "UNKNOWN")

    notes = ["<ul style='margin:0; padding-left:20px;'>"]
    if int(win.get("fail", 0) or 0) == 0:
        notes.append("<li>No critical failures detected.</li>")
    else:
        notes.append("<li>❌ Critical failures detected — review FAILED JOBS above.</li>")
    if zero:
        notes.append(f"<li>⏳ No runs detected: {_html_escape(', '.join(zero))}</li>")
    notes.append("</ul>")
    notes_html = "".join(notes)

    body = f"""
    <html>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; line-height:1.45; padding:16px;">
        <div style="max-width:720px; margin:0 auto;">
          <p style="margin:0 0 8px 0;">Hello,</p>
          <p style="margin:0 0 14px 0;">This is the automated health report for Plex-related background jobs.</p>
          <hr style="border:none; border-top:1px solid #9ca3af; margin:16px 0;" />

          {section("📊 OVERALL STATUS", overall_lines)}
          <hr style="border:none; border-top:1px solid #9ca3af; margin:16px 0;" />

          {section("✅ SUCCESSFUL JOBS", successful_list)}

          {section("⚠️ PARTIAL COMPLETIONS", partial_block) if partial_block else ""}
          {section("❌ FAILED JOBS", fail_block) if fail_block else ""}
          {section("❔ UNKNOWN JOBS", unknown_block) if unknown_block else ""}

          <hr style="border:none; border-top:1px solid #9ca3af; margin:16px 0;" />
          {section("📝 NOTES", notes_html)}
        </div>
      </body>
    </html>
    """
    return body.strip()


def _send_gmail_smtp(
    *,
    smtp_host: str,
    smtp_port: int,
    username: str,
    app_password: str,
    from_email: str,
    to_emails: list[str],
    subject: str,
    body: str,
    html_body: str | None = None,
) -> None:
    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = ", ".join(to_emails)
    msg["Subject"] = subject
    msg.set_content(body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(username, app_password)
        server.send_message(msg)


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)

    base_dir = _default_base_dir()
    logs_dir = Path(args.logs_dir) if args.logs_dir.strip() else (base_dir / "data" / "logs")
    out_dir = Path(args.out_dir) if args.out_dir.strip() else (base_dir / "data" / "health")

    now = datetime.now()
    since = now - timedelta(days=max(1, int(args.since_days or 7)))

    always_include_scripts = _discover_expected_scripts(base_dir)

    logger.info("=" * 60)
    logger.info("WEEKLY LOG HEALTH REPORT")
    logger.info("=" * 60)
    logger.info(f"Logs dir: {logs_dir}")
    logger.info(f"Output dir: {out_dir}")
    logger.info(f"Window: {since.isoformat(timespec='seconds')} -> {now.isoformat(timespec='seconds')}")

    paths = write_health_outputs(
        logs_dir=logs_dir,
        out_dir=out_dir,
        base_dir=base_dir,
        since=since,
        until=now,
        always_include_scripts=always_include_scripts,
    )
    events = collect_log_events(logs_dir=logs_dir, since=since, until=now, base_dir=base_dir)
    summary = summarize_events(events, always_include_scripts=always_include_scripts)

    win = summary.get("window", {})
    logger.info("")
    logger.info(
        f"Runs: {win.get('runs', 0)} | "
        f"SUCCESS: {win.get('success', 0)} | "
        f"PARTIAL: {win.get('partial', 0)} | "
        f"FAIL: {win.get('fail', 0)} | "
        f"UNKNOWN: {win.get('unknown', 0)}"
    )
    logger.info("")
    logger.info(f"Wrote: {paths.get('health_index')}")
    logger.info(f"Wrote: {paths.get('latest')}")
    logger.info(f"Wrote: {paths.get('weekly')}")

    if args.send_email:
        from tautulli_curated.helpers.config_loader import load_config

        cfg = load_config()
        email_cfg = cfg.alerts.email

        if not email_cfg.enabled:
            logger.error(
                "Email alerts are not enabled/configured. Set alerts.email.enabled=true and provide "
                "alerts.email.username, alerts.email.app_password, and alerts.email.to_emails in config/config.local.yaml."
            )
            return 30

        problems = [e for e in events if e.status != "SUCCESS"]
        if email_cfg.send_only_on_problems and not problems:
            logger.info("No problems detected and alerts.email.send_only_on_problems=true; skipping email.")
            return 0

        w = summary.get("window", {}) or {}
        ok = int(w.get("success", 0) or 0)
        warn = int(w.get("partial", 0) or 0)
        fail = int(w.get("fail", 0) or 0)
        unk = int(w.get("unknown", 0) or 0)

        if fail > 0:
            icon = "❌"
            health = "FAIL"
        elif warn > 0 or unk > 0:
            icon = "⚠️"
            health = "WARN"
        else:
            icon = "✅"
            health = "OK"

        prefix = (email_cfg.subject_prefix or "").strip()
        label = prefix
        if label.startswith("[") and label.endswith("]"):
            label = label[1:-1].strip()
        if not label:
            label = "Plex Weekly Health"
        elif "health" not in label.lower():
            label = f"{label} Weekly Health"

        counts: list[str] = []
        if ok:
            counts.append(f"✅{ok}")
        if warn:
            counts.append(f"⚠️{warn}")
        if fail:
            counts.append(f"❌{fail}")
        if unk:
            counts.append(f"❔{unk}")
        counts_str = " ".join(counts) if counts else "no runs"

        # Subject style (match the "Health YYYY-MM-DD: WARN (✅8 ⚠️4)" format)
        subject = f"Health {now.strftime('%Y-%m-%d')}: {health} ({counts_str})"
        body = _format_email_body(since=since, until=now, summary=summary, events=events, written_paths=paths)
        html_body = _format_email_body_html(since=since, until=now, summary=summary)

        logger.info("")
        logger.info(f"Sending email to: {', '.join(email_cfg.to_emails)}")
        try:
            _send_gmail_smtp(
                smtp_host=email_cfg.smtp_host,
                smtp_port=email_cfg.smtp_port,
                username=email_cfg.username,
                app_password=email_cfg.app_password,
                from_email=email_cfg.from_email or email_cfg.username,
                to_emails=email_cfg.to_emails,
                subject=subject,
                body=body,
                html_body=html_body,
            )
            logger.info("Email sent.")
        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"Gmail SMTP authentication failed: {e}")
            logger.error(
                "Most common fix: enable 2-Step Verification on the Gmail account and generate a Gmail App Password, "
                "then set alerts.email.app_password to that App Password (not your normal Gmail login password)."
            )
            logger.error("See: https://myaccount.google.com/apppasswords")
            return 31
        except (smtplib.SMTPException, OSError) as e:
            logger.error(f"Failed to send email via SMTP: {type(e).__name__}: {e}")
            return 32

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


