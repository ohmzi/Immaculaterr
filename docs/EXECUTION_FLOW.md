# Complete Script Execution Flow

## When Does It Run?

The script is triggered automatically by **Tautulli** when a user finishes watching a movie. Tautulli calls the script with two arguments:
- **Movie Title** (e.g., "Inception (2010)")
- **Media Type** (should be "movie")

The script can also be run manually from the command line:
```bash
python3 src/tautulli_curated/main.py "Movie Title" movie
```

---

## Complete Execution Sequence

The script executes in a **strict sequential order**. Each step can be enabled or disabled via `config/config.yaml`. Here's the complete flow:

---

## **INITIALIZATION**

### Step 0: Script Startup
**What happens:**
- Script receives movie title and media type from Tautulli
- Loads configuration from `config/config.yaml`
- Reads all boolean flags to determine which scripts should run
- Displays execution configuration (which scripts are enabled/disabled)
- Starts timing the entire execution

**Output:**
```
TAUTULLI CURATED COLLECTION SCRIPTS START
Movie: Inception
Media type: movie

Script Execution Configuration:
  ✓ Recently Watched Collection: ENABLED
  ✓ Plex Duplicate Cleaner: ENABLED
  ✓ Radarr Monitor Confirm: ENABLED
  ✓ Immaculate Taste Collection: ENABLED
  ✓ Collection Refresher: ENABLED
  ✓ Immaculate Taste Refresher: ENABLED

Execution Order:
  1. Recently Watched Collection (if enabled)
  2. Plex Duplicate Cleaner (if enabled)
  3. Radarr Monitor Confirm (if enabled)
  4. Immaculate Taste Collection (if enabled)
  5a. Recently Watched Collection Refresher (if enabled - smaller/quicker)
  5b. Immaculate Taste Collection Refresher (if enabled - larger/takes longer)
```

---

## **STEP 1: RECENTLY WATCHED COLLECTION** (if enabled)

**Config Flag:** `run_recently_watched_collection: true`

### What It Does:

This script generates recommendations for **two separate collections** based on the movie you just watched:

#### **A. "Based on your recently watched movie" Collection**

1. **Gets Recommendations:**
   - Calls OpenAI GPT with the movie you just watched
   - Requests up to 15 similar movie recommendations
   - GPT analyzes tone, themes, atmosphere, and cinematic style
   - Returns a list of movie titles

2. **Checks Plex Library:**
   - For each recommended movie, searches your Plex library
   - Uses server-side search for fast lookups
   - Normalizes titles (removes year suffixes) for accurate matching
   - Separates movies into:
     - **Found in Plex** → Added to collection list
     - **Missing in Plex** → Added to Radarr queue

3. **Saves to JSON:**
   - Saves all found movies to `data/recently_watched_collection.json`
   - Each movie includes: `title`, `rating_key`, `year`
   - **Note:** Movies are NOT added to Plex yet (that happens in Step 5a)

4. **Sends Missing Movies to Radarr:**
   - For each missing movie:
     - Looks up movie in Radarr by TMDb ID
     - If movie exists but is unmonitored → Sets to monitored
     - If movie doesn't exist → Adds to Radarr with:
       - Root folder (from config)
       - Quality profile (from config)
       - Tags: `["movies", "due-to-previously-watched"]`
       - Triggers automatic search

#### **B. "Change of Taste" Collection**

1. **Gets Contrast Recommendations:**
   - Calls OpenAI GPT with a special prompt
   - Requests up to 15 movies that are **opposite** in tone/genre/style
   - For example: If you watched a dark thriller, it recommends light comedies
   - This acts as a "palate cleanser" collection

2. **Checks Plex Library:**
   - Same process as above - searches Plex for each recommendation
   - Separates found vs. missing movies

3. **Saves to JSON:**
   - Saves all found movies to `data/change_of_taste_collection.json`
   - Same format as above

4. **Sends Missing Movies to Radarr:**
   - Same process as above
   - Tags: `["movies", "change-of-taste"]`

### Output:
```
RUNNING RECENTLY WATCHED COLLECTION SCRIPT
This script generates recommendations for:
  - 'Based on your recently watched movie' collection
  - 'Change of Taste' collection

Step 1: Getting recommendations from ChatGPT...
  ✓ ChatGPT returned 15 recommendations
Step 2: Checking movies in Plex...
  ✓ Found 12 movies in Plex
  ✓ 3 movies missing in Plex
Step 3: Saved 12 movies to recently_watched_collection.json
  ✓ Collection state saved (will be applied by refresher)
Step 4: Processing 3 missing movies in Radarr...
  ✓ Processed 3 movies in Radarr
  ✓ Recently Watched Collection script completed successfully
```

**Time:** ~30-60 seconds (smaller/quicker)

---

## **STEP 2: PLEX DUPLICATE CLEANER** (if enabled)

**Config Flag:** `run_plex_duplicate_cleaner: true`

### What It Does:

Scans your entire Plex movie library to find and remove duplicate movies.

1. **Scans Plex Library:**
   - Connects to Plex server
   - Retrieves all movies from your movie library
   - Groups movies by TMDb ID (movies with same TMDb ID are duplicates)

2. **Identifies Duplicates:**
   - For each group of duplicates:
     - Compares file sizes, quality, and dates
     - Determines which file to delete based on `delete_preference`:
       - `smallest_file` - Delete smallest file
       - `largest_file` - Delete largest file (default)
       - `newest` - Delete newest file
       - `oldest` - Delete oldest file
     - Respects `preserve_quality` settings (e.g., keeps files with "4K" or "1080p" in filename)

3. **Deletes Duplicates:**
   - Removes lower quality duplicate files from disk
   - Updates Plex library to reflect deletions

4. **Unmonitors in Radarr:**
   - For each deleted movie:
     - Checks if movie exists in Radarr
     - If monitored → Unmonitors to prevent re-download
     - Prevents unnecessary downloads

### Output:
```
RUNNING PLEX DUPLICATE CLEANER
This script will:
  - Scan Plex library for duplicate movies
  - Delete lower quality duplicates based on preferences
  - Unmonitor movies in Radarr after deletion

Scanning library...
  ✓ Found 5 duplicate groups
  ✓ Removed 5 duplicate files
  ✓ Unmonitored 3 movies in Radarr
  ✓ Duplicate Cleaner completed: Found 5 duplicates, Removed 5
```

**Time:** ~1-5 minutes (depends on library size)

---

## **STEP 3: RADARR MONITOR CONFIRM** (if enabled)

**Config Flag:** `run_radarr_monitor_confirm_plex: true`

### What It Does:

Synchronizes Radarr's monitoring status with your Plex library to prevent unnecessary downloads.

1. **Gets All Monitored Movies from Radarr:**
   - Connects to Radarr API
   - Retrieves all movies that are currently monitored
   - For each monitored movie, gets TMDb ID

2. **Checks Each Movie in Plex:**
   - For each monitored movie in Radarr:
     - Searches Plex library using TMDb ID
     - Determines if movie already exists in Plex

3. **Unmonitors Movies Already in Plex:**
   - If movie exists in Plex → Unmonitors in Radarr
   - Prevents Radarr from trying to download movies you already have
   - Keeps Radarr in sync with your Plex library

### Output:
```
RUNNING RADARR MONITOR CONFIRM
This script will:
  - Check all monitored movies in Radarr
  - Unmonitor movies that already exist in Plex

Checking monitored movies...
  ✓ Radarr Monitor Confirm completed:
    - Total monitored: 150
    - Already in Plex: 45
    - Unmonitored: 45
```

**Time:** ~30-90 seconds (depends on number of monitored movies)

---

## **STEP 4: IMMACULATE TASTE COLLECTION** (if enabled)

**Config Flag:** `run_immaculate_taste_collection: true`

### What It Does:

This is the **main recommendation pipeline** with a sophisticated points system that maintains a curated collection over time.

1. **Loads Points System:**
   - Reads `data/recommendation_points.json`
   - This file contains all movies with their current point values
   - Points determine which movies stay in the collection

2. **Gets Recommendations:**
   - **Primary:** Calls OpenAI GPT with the movie you just watched
     - Requests up to 50 movie recommendations
     - GPT analyzes tone, themes, atmosphere, cinematic style
     - Includes mix of mainstream, indie, international, arthouse films
   - **Fallback:** If OpenAI fails, uses TMDb API
     - Merges recommendations from `/recommendations`, `/similar`, `/discover` endpoints
     - Filters by genre overlap and vote count
     - Scores by TMDb rating (cached)

3. **Checks Plex Library:**
   - For each recommended movie:
     - Searches Plex library using server-side search
     - Normalizes titles for accurate matching
     - Separates into found vs. missing

4. **Updates Points System:**
   - **New recommendations:** Get +1 point (added to points file)
   - **Existing movies:** Points remain unchanged
   - **Movies with 0 or negative points:** Removed from collection (cleaned up)

5. **Sends Missing Movies to Radarr:**
   - Same process as Step 1
   - Tags: `["movies", "recommended"]` (from config)

6. **Saves Points Data:**
   - Writes updated points to `data/recommendation_points.json`
   - **Note:** Movies are NOT added to Plex yet (that happens in Step 5b)

### Output:
```
RUNNING IMMACULATE TASTE COLLECTION SCRIPT
Running main pipeline...

Step 1: Getting recommendations...
  ✓ OpenAI returned 50 recommendations
Step 2: Checking movies in Plex...
  ✓ Found 35 movies in Plex
  ✓ 15 movies missing in Plex
Step 3: Updating points system...
  ✓ Added 35 new recommendations (+1 point each)
  ✓ Maintained points for existing movies
  ✓ Removed 5 movies with 0 points
Step 4: Processing missing movies in Radarr...
  ✓ Processed 15 movies in Radarr
Step 5: Saving points data...
  ✓ Saved to recommendation_points.json
  ✓ Main pipeline completed successfully
```

**Time:** ~1-3 minutes (depends on number of recommendations)

---

## **STEP 5A: RECENTLY WATCHED COLLECTION REFRESHER** (if enabled)

**Config Flag:** `run_recently_watched_refresher: true`

### What It Does:

**This is MANDATORY** - This script actually adds movies to Plex collections! Without it, movies are only saved to JSON files but never appear in Plex.

1. **Loads JSON Files:**
   - Reads `data/recently_watched_collection.json`
   - Reads `data/change_of_taste_collection.json`
   - Gets list of movies for each collection

2. **Randomizes Order:**
   - Randomizes the order of movies in memory
   - Creates a fresh presentation each time
   - No need to save randomized order (will be randomized again next time)

3. **Updates "Based on your recently watched movie" Collection:**
   - Connects to Plex server
   - Finds or creates the collection
   - **Removes all existing items** from the collection
   - **Adds all movies** from JSON in randomized order
   - Filters out non-movie items (clips, shows, etc.) automatically
   - Handles connection timeouts gracefully

4. **Updates "Change of Taste" Collection:**
   - Same process as above
   - Removes all items, adds all movies in randomized order

5. **Applies Custom Order:**
   - Sets custom order in Plex (may take time for large collections)
   - Handles errors gracefully (continues if some items fail)

### Output:
```
RUNNING RECENTLY WATCHED COLLECTION REFRESHER
Starting Recently Watched Collection Refresher...
  This will:
    1. Read recently_watched_collection.json and change_of_taste_collection.json
    2. Randomize the order of movies in each collection
    3. Remove all items from each Plex collection
    4. Add all items back in randomized order
  Note: This process may take a while for large collections

Loading collections...
  ✓ Loaded 12 movies from recently_watched_collection.json
  ✓ Loaded 10 movies from change_of_taste_collection.json
Randomizing order...
  ✓ Order randomized
Updating "Based on your recently watched movie" collection...
  ✓ Removed 12 items
  ✓ Adding 12 items...
  ✓ Added 12 items successfully
Updating "Change of Taste" collection...
  ✓ Removed 10 items
  ✓ Adding 10 items...
  ✓ Added 10 items successfully
  ✓ Recently Watched Collection Refresher completed successfully
```

**Time:** ~30-60 seconds (smaller/quicker - runs first)

---

## **STEP 5B: IMMACULATE TASTE COLLECTION REFRESHER** (if enabled)

**Config Flag:** `run_collection_refresher: true`

### What It Does:

**This is MANDATORY** - This script actually adds movies to the main Plex collection! Without it, movies are only saved to JSON but never appear in Plex.

1. **Loads Points Data:**
   - Reads `data/recommendation_points.json`
   - Filters movies with points > 0 (only movies that should be in collection)
   - Gets list of all movies with their rating keys

2. **Randomizes Order:**
   - Randomizes the order of movies in memory
   - Creates a fresh presentation each time
   - For large collections (1000+ items), this can take time

3. **Updates "Inspired by your Immaculate Taste" Collection:**
   - Connects to Plex server
   - Finds or creates the collection
   - **Removes all existing items** from the collection
   - **Adds all movies** from points file in randomized order
   - Filters out non-movie items (clips, shows, etc.) automatically
   - Handles connection timeouts and retries gracefully

4. **Applies Custom Order:**
   - Sets custom order in Plex
   - For large collections (1000+ items), this can take 1-2 hours
   - Shows progress: "Reordering progress: 500/1200 items (42%)"
   - Handles errors gracefully (continues if some items fail to reorder)

### Output:
```
RUNNING IMMACULATE TASTE COLLECTION REFRESHER
Starting Immaculate Taste Collection Refresher...
  This will:
    1. Read recommendation_points.json
    2. Randomize the order of movies
    3. Remove all items from the Plex collection
    4. Add all items back in randomized order
  Note: This process may take a while for large collections

Loading points data...
  ✓ Loaded 1250 movies with points > 0
Randomizing order...
  ✓ Order randomized
Updating "Inspired by your Immaculate Taste" collection...
  ✓ Removed 1250 items
  ✓ Adding 1250 items...
  ✓ Added 1250 items successfully
Reordering items...
  Reordering progress: 1250/1250 items (100%) - 1245 successful, 5 failed
  ✓ Immaculate Taste Collection Refresher completed successfully
```

**Time:** ~1-2 hours for large collections (1000+ items) - runs last

---

## **FINAL SUMMARY**

After all steps complete, the script displays a summary:

```
TAUTULLI CURATED COLLECTION SCRIPTS SUMMARY
Execution Summary:
  - Recently Watched Collection: ✓ Completed
  - Plex Duplicate Cleaner: ✓ Completed
  - Radarr Monitor Confirm: ✓ Completed
  - Immaculate Taste Collection: ✓ Completed
  - Collection Refreshers: ✓ Completed
Total execution time: 125.3 seconds
TAUTULLI CURATED COLLECTION SCRIPTS END OK
```

---

## **Key Points**

1. **Sequential Execution:** Each step runs one after another. If one step fails, the script continues with the next step (unless it's a critical error).

2. **Configurable:** Every step can be enabled/disabled via `config/config.yaml`.

3. **Refreshers are MANDATORY:** Without the refreshers (Step 5a and 5b), movies are saved to JSON files but **never added to Plex collections**. The refreshers are what actually apply the collections to Plex.

4. **Order Matters:** 
   - Smaller tasks run first (Recently Watched)
   - Larger tasks run last (Immaculate Taste Refresher)
   - This ensures quick tasks complete before long-running tasks

5. **Error Handling:** Each step has robust error handling. If one step fails, the script logs the error and continues with the next step.

6. **Independent Execution:** The refreshers can be run independently via bash scripts during off-peak hours if you set them to `false` in config.

---

## **Data Files Created/Updated**

- `data/recently_watched_collection.json` - Recently Watched collection data
- `data/change_of_taste_collection.json` - Change of Taste collection data
- `data/recommendation_points.json` - Points system for Immaculate Taste collection
- `data/tmdb_cache.json` - TMDb API cache (reduces API calls)

---

## **Plex Collections Updated**

- "Based on your recently watched movie" - Similar recommendations
- "Change of Taste" - Contrasting recommendations
- "Inspired by your Immaculate Taste" - Curated collection with points system

---

This completes the entire execution flow. The script is designed to be robust, configurable, and efficient, handling everything from recommendation generation to Plex collection updates automatically.

