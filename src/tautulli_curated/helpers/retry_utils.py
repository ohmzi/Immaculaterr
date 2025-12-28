"""
Retry utilities for handling connectivity and timeout issues with Plex and Radarr.
"""
import time
import logging
from typing import Callable, TypeVar, Optional, Tuple
from requests.exceptions import Timeout, ConnectionError as RequestsConnectionError, RequestException, HTTPError
from urllib3.exceptions import ReadTimeoutError, ConnectTimeoutError
from plexapi.exceptions import BadRequest, NotFound

logger = logging.getLogger(__name__)

T = TypeVar('T')

# Default retry configuration
DEFAULT_MAX_RETRIES = 3
DEFAULT_RETRY_DELAY = 2  # seconds
DEFAULT_BACKOFF_MULTIPLIER = 2


def is_retryable_error(exception: Exception) -> bool:
    """
    Determine if an exception is retryable.
    
    Returns True for network/timeout errors that might succeed on retry.
    Returns False for permanent errors (auth, not found, bad request, etc.).
    """
    # HTTP errors - check status code first (HTTPError is a subclass of RequestException, so check it first)
    if isinstance(exception, HTTPError):
        # Check if response attribute exists and has status_code
        if hasattr(exception, 'response') and hasattr(exception.response, 'status_code'):
            status_code = exception.response.status_code
            # Don't retry on client errors (4xx) - these are permanent
            if 400 <= status_code < 500:
                return False
            # Retry on server errors (5xx) - these might be transient
            if 500 <= status_code < 600:
                return True
        # If no response, check error message
        error_str = str(exception).lower()
        if any(keyword in error_str for keyword in ['400', '401', '403', '404', 'bad request', 'unauthorized', 'forbidden', 'not found']):
            return False
    
    # Network and timeout errors - retryable
    if isinstance(exception, (Timeout, ReadTimeoutError, ConnectTimeoutError, RequestsConnectionError)):
        return True
    
    # Connection errors - retryable
    if isinstance(exception, ConnectionError):
        return True
    
    # Request exceptions that might be transient (check after HTTPError since HTTPError is a subclass)
    if isinstance(exception, RequestException) and not isinstance(exception, HTTPError):
        error_str = str(exception).lower()
        # Don't retry on client errors (4xx) - these are permanent
        if any(keyword in error_str for keyword in ['400', '401', '403', '404', 'bad request', 'unauthorized', 'forbidden', 'not found']):
            return False
        # Retry on timeout-related errors
        if any(keyword in error_str for keyword in ['timeout', 'connection', 'network', 'unreachable']):
            return True
    
    # Plex API errors - some are retryable
    error_str = str(exception).lower()
    error_type = type(exception).__name__.lower()
    
    # Retry on timeout/connection errors
    if any(keyword in error_str for keyword in ['timeout', 'connection', 'network', 'unreachable', 'overloaded']):
        return True
    
    # Don't retry on permanent errors
    if isinstance(exception, (BadRequest, NotFound)):
        return False
    
    # Don't retry on authentication errors
    if any(keyword in error_str for keyword in ['401', 'unauthorized', 'forbidden', '403', 'authentication']):
        return False
    
    # Don't retry on not found errors
    if any(keyword in error_str for keyword in ['404', 'not found']):
        return False
    
    # Default: retry on unknown errors (might be transient)
    return True


def retry_with_backoff(
    func: Callable[[], T],
    max_retries: int = DEFAULT_MAX_RETRIES,
    retry_delay: float = DEFAULT_RETRY_DELAY,
    backoff_multiplier: float = DEFAULT_BACKOFF_MULTIPLIER,
    logger_instance: Optional[logging.Logger] = None,
    operation_name: str = "operation",
    raise_on_final_failure: bool = True,
) -> Tuple[Optional[T], bool]:
    """
    Retry a function call with exponential backoff.
    
    Args:
        func: Function to call (no arguments)
        max_retries: Maximum number of retry attempts
        retry_delay: Initial delay between retries (seconds)
        backoff_multiplier: Multiplier for exponential backoff
        logger_instance: Optional logger for error messages
        operation_name: Name of operation for logging
        raise_on_final_failure: If True, raise exception on final failure; if False, return (None, False)
    
    Returns:
        Tuple of (result, success). If raise_on_final_failure is True and all retries fail, raises exception.
    """
    log = logger_instance or logger
    last_exception = None
    
    for attempt in range(max_retries + 1):  # +1 for initial attempt
        try:
            result = func()
            if attempt > 0:
                log.info(f"{operation_name}: succeeded on attempt {attempt + 1}")
            return (result, True)
        except Exception as e:
            last_exception = e
            
            # Check if error is retryable
            if not is_retryable_error(e):
                log.warning(f"{operation_name}: non-retryable error: {type(e).__name__}: {e}")
                if raise_on_final_failure:
                    raise
                return (None, False)
            
            # If this was the last attempt, don't wait
            if attempt < max_retries:
                delay = retry_delay * (backoff_multiplier ** attempt)
                error_type = type(e).__name__
                log.warning(
                    f"{operation_name}: attempt {attempt + 1}/{max_retries + 1} failed ({error_type}): {e}"
                )
                log.info(f"{operation_name}: retrying in {delay:.1f} seconds...")
                time.sleep(delay)
            else:
                log.error(f"{operation_name}: failed after {max_retries + 1} attempts: {type(e).__name__}: {e}")
    
    # All retries exhausted
    if raise_on_final_failure:
        raise last_exception
    return (None, False)


def safe_execute(
    func: Callable[[], T],
    logger_instance: Optional[logging.Logger] = None,
    operation_name: str = "operation",
    default_return: Optional[T] = None,
    log_errors: bool = True,
) -> Optional[T]:
    """
    Safely execute a function, catching all exceptions and returning default on failure.
    
    Use this for operations that should not stop the script if they fail.
    
    Args:
        func: Function to call (no arguments)
        logger_instance: Optional logger for error messages
        operation_name: Name of operation for logging
        default_return: Value to return on failure (default: None)
        log_errors: Whether to log errors
    
    Returns:
        Function result on success, default_return on failure
    """
    try:
        return func()
    except Exception as e:
        if log_errors and logger_instance:
            error_type = type(e).__name__
            logger_instance.warning(f"{operation_name}: failed ({error_type}): {e}")
        return default_return

