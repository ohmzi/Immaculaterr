import re
from typing import Optional
from tautulli_curated.helpers.retry_utils import safe_execute

def normalize(title: str) -> str:
    return re.sub(r"\s*\(\d{4}\)\s*$", "", title).strip().lower()

def find_plex_movie(plex, title, library_name: str = "Movies", logger=None):
    """
    Fast Plex lookup using server-side search with error handling.
    
    Args:
        plex: PlexServer instance
        title: Movie title to search for
        library_name: Name of the library section (default: "Movies")
        logger: Optional logger instance
    
    Returns:
        Movie object if found, None otherwise
    """
    def _search():
        section = plex.library.section(library_name)
        results = section.search(title=title)
        
        if not results:
            return None
        
        target = normalize(title)
        
        for movie in results:
            if normalize(movie.title) == target:
                return movie
        
        return None
    
    # Use safe_execute to handle connection/timeout errors gracefully
    result = safe_execute(
        _search,
        logger_instance=logger,
        operation_name=f"Plex search for '{title}'",
        default_return=None,
        log_errors=True,
    )
    
    return result

