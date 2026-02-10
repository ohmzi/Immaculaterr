import { useId, type SVGProps } from 'react';

export function RadarrLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M5 3L19 12L5 21V3Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SonarrLogo(props: SVGProps<SVGSVGElement>) {
  const uid = useId().replace(/:/g, '');
  const discId = `sonarrDisc-${uid}`;

  return (
    <svg
      viewBox="0 0 64 64"
      width="24"
      height="24"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <radialGradient
          id={discId}
          cx="22"
          cy="20"
          r="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="rgba(255,255,255,0.14)" />
          <stop offset="0.55" stopColor="rgba(255,255,255,0.07)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.03)" />
        </radialGradient>
      </defs>

      {/* Disc (helps the logo read cleanly on a very dark tile) */}
      <circle
        cx="32"
        cy="32"
        r="28"
        fill={`url(#${discId})`}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
      />

      {/* 4‑segment “aperture” ring (closer to the real Sonarr mark than a generic dashed circle) */}
      <circle
        cx="32"
        cy="32"
        r="18.5"
        fill="none"
        stroke="rgba(255,255,255,0.94)"
        strokeWidth="11.5"
        strokeLinecap="round"
        strokeDasharray="21 8"
        transform="rotate(-45 32 32)"
      />

      {/* Soft inner highlight so the segments feel a bit beveled */}
      <circle
        cx="32"
        cy="32"
        r="18.5"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="21 8"
        transform="rotate(-45 32 32)"
      />

      {/* Center glow + core */}
      <circle cx="32" cy="32" r="10.5" fill="#38bdf8" opacity="0.14" />
      <circle cx="32" cy="32" r="5.8" fill="#38bdf8" opacity="0.95" />
      <circle cx="29.5" cy="28.8" r="1.4" fill="rgba(255,255,255,0.65)" opacity="0.35" />
    </svg>
  );
}

export function TmdbLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="24"
      height="24"
      aria-hidden="true"
      {...props}
    >
      {/* Rounded badge outline (inspired by the TMDB mark you shared) */}
      <rect
        x="12"
        y="12"
        width="40"
        height="40"
        rx="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
        opacity="0.95"
      />

      {/* TM / DB monogram */}
      <g fill="currentColor" opacity="0.98">
        {/* T */}
        <path d="M18 20H32V24H27V34H23V24H18V20Z" />
        {/* M */}
        <path d="M34 34V20H38L42 25L46 20H50V34H46V27L42 32L38 27V34H34Z" />
        {/* D (even-odd for a clean counter) */}
        <path
          fillRule="evenodd"
          d="
            M18 36H26.5C30.5 36 34 38.9 34 43C34 47.1 30.5 50 26.5 50H18V36Z
            M22 40H26.2C28.5 40 30 41.5 30 43C30 44.5 28.5 46 26.2 46H22V40Z
          "
          clipRule="evenodd"
        />
        {/* B (even-odd for two counters) */}
        <path
          fillRule="evenodd"
          d="
            M36 36H43.5C46.6 36 48.2 37.4 48.2 39.7C48.2 41.4 47.2 42.3 45.7 42.8C47.8 43.3 49 44.5 49 46.8C49 49 47.1 50 43.7 50H36V36Z
            M40 40H42.8C44.2 40 44.8 40.4 44.8 41.4C44.8 42.4 44.2 42.8 42.8 42.8H40V40Z
            M40 44.4H43C44.5 44.4 45.1 44.9 45.1 46C45.1 47.2 44.5 47.6 43 47.6H40V44.4Z
          "
          clipRule="evenodd"
        />
      </g>
    </svg>
  );
}

export function GoogleLogo(props: SVGProps<SVGSVGElement>) {
  const uid = useId().replace(/:/g, '');
  const glowId = `googleGlow-${uid}`;

  // Neon-inspired Google "G" glyph (single-letter mark).
  // Geometry is based on the canonical Google G and then layered for a neon look.
  const d =
    'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z';
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <filter
          id={glowId}
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Glow underlay */}
      <g filter={`url(#${glowId})`} opacity="0.8">
        <path d={d} fill="currentColor" opacity="0.8" />
      </g>

      {/* Crisp mark */}
      <path d={d} fill="currentColor" opacity="0.95" />
      <path
        d={d}
        fill="none"
        stroke="rgba(255,255,255,0.75)"
        strokeWidth="0.65"
        opacity="0.18"
      />
    </svg>
  );
}

export function OpenAiLogo(props: SVGProps<SVGSVGElement>) {
  const uid = useId().replace(/:/g, '');
  const glowId = `openaiGlow-${uid}`;
  const highlightId = `openaiHighlight-${uid}`;

  // Base mark from the Simple Icons OpenAI glyph (scaled to 24x24),
  // then layered with a blue glow + subtle white highlight for the neon feel.
  const d =
    'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z';

  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <filter
          id={glowId}
          x="-60%"
          y="-60%"
          width="220%"
          height="220%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={highlightId} x1="4" y1="4" x2="20" y2="20">
          <stop offset="0" stopColor="rgba(255,255,255,0.98)" />
          <stop offset="0.55" stopColor="rgba(255,255,255,0.92)" />
          <stop offset="1" stopColor="rgba(255,255,255,0.78)" />
        </linearGradient>
      </defs>

      {/* Blue glow underlay */}
      <g filter={`url(#${glowId})`} opacity="0.85">
        <path d={d} fill="#60a5fa" />
      </g>

      {/* Crisp mark */}
      <path d={d} fill={`url(#${highlightId})`} />
    </svg>
  );
}

export function PlexLogo(props: SVGProps<SVGSVGElement>) {
  const uid = useId().replace(/:/g, '');
  const gradId = `plexGrad-${uid}`;
  const glowId = `plexGlow-${uid}`;

  // Neon-inspired Plex chevron: a hollow “>” with a warm amber gradient + soft glow.
  return (
    <svg
      viewBox="0 0 64 64"
      width="24"
      height="24"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient
          id={gradId}
          x1="18"
          y1="10"
          x2="48"
          y2="54"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#facc15" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <filter
          id={glowId}
          x="-60%"
          y="-60%"
          width="220%"
          height="220%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="2.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Glow underlay */}
      <g filter={`url(#${glowId})`} opacity="0.55">
        <path
          d="M18 12H30L46 32L30 52H18L34 32Z"
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="11"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </g>

      {/* Crisp outline */}
      <path
        d="M18 12H30L46 32L30 52H18L34 32Z"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="7.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function OverseerrLogo(props: SVGProps<SVGSVGElement>) {
  const uid = useId().replace(/:/g, '');
  const ringId = `overseerrRing-${uid}`;

  return (
    <svg
      viewBox="0 0 64 64"
      width="24"
      height="24"
      aria-hidden="true"
      {...props}
    >
      <defs>
        <linearGradient
          id={ringId}
          x1="14"
          y1="14"
          x2="50"
          y2="50"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>

      <circle
        cx="32"
        cy="32"
        r="22"
        fill="none"
        stroke={`url(#${ringId})`}
        strokeWidth="8"
        opacity="0.9"
      />
      <circle cx="32" cy="32" r="8" fill="#22d3ee" opacity="0.22" />
      <circle cx="32" cy="32" r="4.5" fill="#e0f2fe" opacity="0.92" />
    </svg>
  );
}

