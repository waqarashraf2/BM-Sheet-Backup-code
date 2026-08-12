# AI INSTRUCTIONS & PERMISSIONS

**CRITICAL RULE REGARDING SCHEDULERS:**

1. **DO NOT RUN ANY SCHEDULERS LOCALLY:** Never run `php artisan schedule:run` or any individual scheduler command (like `focalcrm:import`, `scrape:focalpbphoto`, etc.) locally unless explicitly forced by the user. ALL of them are strictly prohibited.
2. **DO NOT UNCOMMENT SCHEDULERS:** Schedulers in `routes/console.php` must remain commented out for local development. Do not touch or modify them to enable them.
3. **REASON:** The client API only allows data to be fetched/sent once. If the schedulers run on the local machine, they will pull the data locally, and the live server database will miss out on this data. These tasks must ONLY run on the production server database, not locally.
4. **ABSOLUTELY RESTRICTED SERVICES (SPECIAL ATTENTION):** NEVER run or execute ANY of the import services locally, especially the following ones, under any circumstances:
   - `FocalCrmPhotoService.php`
   - `FocalCrmPrestigeService.php`
   - `FocalCrmService.php`
   - `FocalRtvService.php`

Whenever you are asked to work on this project, adhere strictly to this rule to avoid data loss on the client side.
