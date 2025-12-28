# Error Handling and Retry Logic

## Overview

The script now includes comprehensive error handling and retry logic to ensure it can continue running even when Plex or Radarr experience connectivity issues, timeouts, or temporary errors.

## Retry Utilities

A new `retry_utils.py` module provides:

### `retry_with_backoff()`
- Retries operations up to 3 times with exponential backoff
- Automatically detects retryable errors (timeouts, connection issues)
- Skips retries for permanent errors (authentication, not found, bad request)
- Returns `(result, success)` tuple

### `safe_execute()`
- Executes operations and catches all exceptions
- Returns default value on failure instead of raising
- Used for operations that shouldn't stop the script

### `is_retryable_error()`
- Determines if an error is worth retrying
- Retryable: timeouts, connection errors, network issues
- Non-retryable: authentication errors, not found, bad requests

## Implementation Details

### Plex Operations

**All Plex connections now:**
- Use `timeout=30` seconds
- Retry up to 3 times on connection failures
- Continue script execution even if connection fails (where appropriate)

**Plex collection operations:**
- `addItems()` - Retries up to 3 times
- `removeItems()` - Retries up to 3 times
- `createCollection()` - Retries up to 3 times
- Continues even if some operations fail

**Plex search operations:**
- `find_plex_movie()` - Uses `safe_execute()` to handle errors gracefully
- Returns `None` on failure instead of raising exceptions
- Script continues processing other movies

### Radarr Operations

**All Radarr API calls now:**
- Use appropriate timeouts (30s for quick ops, 60s for longer ops)
- Retry up to 3 times on failures
- Return statistics instead of raising exceptions

**Radarr functions with retry logic:**
- `get_or_create_tag()` - Retries tag creation
- `_radarr_get_all_movies()` - Retries fetching all movies
- `radarr_lookup_movie()` - Retries movie lookup
- `radarr_set_monitored()` - Retries setting monitored status
- `radarr_add_and_search()` - Retries adding movies
- `radarr_add_or_monitor_missing()` - Handles errors per movie, continues processing

**Return values:**
- `radarr_add_or_monitor_missing()` now returns `{"added": count, "monitored": count, "failed": count}`
- Script logs warnings for failed movies but continues

### Main Script Error Handling

**The main script now:**
- Catches exceptions from each sub-script
- Logs errors but continues to next script
- Only fails completely on critical errors (config loading, etc.)
- Returns appropriate exit codes

**Error handling per step:**
1. **Recently Watched Collection** - Continues even if fails
2. **Plex Duplicate Cleaner** - Continues even if fails
3. **Radarr Monitor Confirm** - Continues even if fails
4. **Immaculate Taste Collection** - Continues even if fails
5. **Collection Refreshers** - Continues even if fails

## Error Types Handled

### Retryable Errors (automatic retry)
- `Timeout` - Request timeout
- `ReadTimeoutError` - Read timeout
- `ConnectTimeoutError` - Connection timeout
- `ConnectionError` - Network connection errors
- `RequestsConnectionError` - Requests library connection errors
- Errors containing "timeout", "connection", "network", "unreachable", "overloaded"

### Non-Retryable Errors (fail immediately)
- `BadRequest` - Invalid request (400)
- `NotFound` - Resource not found (404)
- Authentication errors (401, 403)
- Errors containing "unauthorized", "forbidden", "not found"

## Configuration

No configuration needed - retry logic is built-in with sensible defaults:
- **Max retries:** 3 attempts
- **Initial delay:** 2 seconds
- **Backoff multiplier:** 2x (exponential backoff)
- **Timeouts:** 30s for quick ops, 60s for longer ops

## Benefits

1. **Resilience:** Script continues even when services are temporarily unavailable
2. **Reliability:** Automatic retries handle transient network issues
3. **Graceful degradation:** Partial failures don't stop the entire script
4. **Better logging:** Clear indication of what failed and why
5. **User-friendly:** Script completes as much as possible even with errors

## Example Scenarios

### Scenario 1: Plex Server Temporarily Unavailable
- Script attempts connection with 30s timeout
- Retries 3 times with exponential backoff (2s, 4s, 8s)
- If all retries fail, logs error and continues to next operation
- Script completes other operations successfully

### Scenario 2: Radarr API Timeout
- Individual movie operations retry up to 3 times
- Failed movies are logged but don't stop processing
- Script continues with remaining movies
- Returns statistics showing successes and failures

### Scenario 3: Plex Collection Update Fails
- `addItems()` operation retries up to 3 times
- If retries fail, logs warning and continues
- Script doesn't crash, allows other operations to complete
- User can re-run script later to retry failed operations

## Logging

All retry attempts and failures are logged:
- **Warning level:** Retry attempts and failures
- **Error level:** Final failures after all retries
- **Info level:** Successful operations after retries

Example log output:
```
Radarr lookup 'Inception': attempt 1/4 failed (Timeout): Request timed out
Radarr lookup 'Inception': retrying in 2.0 seconds...
Radarr lookup 'Inception': succeeded on attempt 2
```

## Testing

The retry logic has been tested and verified:
- All imports work correctly
- Retry utilities function as expected
- Error detection works for common error types
- Script continues execution on failures

