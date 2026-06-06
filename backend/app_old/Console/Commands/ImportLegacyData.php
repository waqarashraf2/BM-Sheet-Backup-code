<?php

namespace App\Console\Commands;

use App\Models\Order;
use App\Models\Project;
use App\Models\Team;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class ImportLegacyData extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'import:legacy 
                            {file : Path to the SQL dump file}
                            {--table=orders : Table to import (orders, users, projects, teams)}
                            {--dry-run : Preview changes without importing}
                            {--skip-duplicates : Skip orders that already exist}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Import data from old Benchmark system SQL dump';

    /**
     * Execute the console command.
     */
    public function handle()
    {
        $filePath = $this->argument('file');
        $table = $this->option('table');
        $dryRun = $this->option('dry-run');
        $skipDuplicates = $this->option('skip-duplicates');

        if (!file_exists($filePath)) {
            $this->error("File not found: {$filePath}");
            return 1;
        }

        $this->info("Reading SQL dump from: {$filePath}");
        $content = file_get_contents($filePath);

        switch ($table) {
            case 'orders':
                return $this->importOrders($content, $dryRun, $skipDuplicates);
            case 'users':
                return $this->importUsers($content, $dryRun, $skipDuplicates);
            case 'projects':
                return $this->importProjects($content, $dryRun, $skipDuplicates);
            case 'teams':
                return $this->importTeams($content, $dryRun, $skipDuplicates);
            case 'all':
                $this->importProjects($content, $dryRun, $skipDuplicates);
                $this->importTeams($content, $dryRun, $skipDuplicates);
                $this->importUsers($content, $dryRun, $skipDuplicates);
                return $this->importOrders($content, $dryRun, $skipDuplicates);
            default:
                $this->error("Unknown table: {$table}");
                return 1;
        }
    }

    protected function importOrders(string $content, bool $dryRun, bool $skipDuplicates): int
    {
        $this->info('Importing orders...');
        
        // Extract INSERT statements for orders
        preg_match('/INSERT INTO `orders`[^;]+;/s', $content, $matches);
        
        if (empty($matches)) {
            $this->warn('No orders found in SQL dump');
            return 0;
        }

        // Parse the INSERT statement
        $insertStatement = $matches[0];
        
        // Extract column names
        preg_match('/INSERT INTO `orders` \(([^)]+)\)/', $insertStatement, $colMatch);
        $columns = array_map(function($c) {
            return trim(str_replace('`', '', $c));
        }, explode(',', $colMatch[1]));

        // Extract values
        preg_match_all('/\(([^)]+)\)(?:,|;)/', $insertStatement, $valueMatches, PREG_SET_ORDER);
        
        // Skip the column definition match
        array_shift($valueMatches);

        $imported = 0;
        $skipped = 0;
        $errors = 0;

        $bar = $this->output->createProgressBar(count($valueMatches));
        $bar->start();

        foreach ($valueMatches as $valueMatch) {
            try {
                $values = $this->parseValues($valueMatch[1]);
                $data = array_combine($columns, $values);
                
                // Map old columns to new schema
                $orderData = $this->mapOrderData($data);

                $projectId = $orderData['project_id'] ?? 1;
                if ($skipDuplicates && Order::forProject($projectId)->where('order_number', $orderData['order_number'])->exists()) {
                    $skipped++;
                    $bar->advance();
                    continue;
                }

                if (!$dryRun) {
                    Order::createForProject($projectId, $orderData);
                }
                $imported++;
            } catch (\Exception $e) {
                $errors++;
                $this->newLine();
                $this->error("Error importing order: " . $e->getMessage());
            }
            $bar->advance();
        }

        $bar->finish();
        $this->newLine(2);

        $this->info("Import complete: {$imported} imported, {$skipped} skipped, {$errors} errors");
        
        if ($dryRun) {
            $this->warn('This was a dry run. No data was actually imported.');
        }

        return 0;
    }

    protected function mapOrderData(array $data): array
    {
        // Remove id to let MySQL auto-increment
        unset($data['id']);
        
        // Clean up NULL strings
        foreach ($data as $key => $value) {
            if ($value === 'NULL' || $value === '') {
                $data[$key] = null;
            }
        }

        // Set workflow state to QUEUED_DRAW if RECEIVED (to start fresh)
        if (($data['workflow_state'] ?? 'RECEIVED') === 'RECEIVED') {
            $data['workflow_state'] = 'QUEUED_DRAW';
        }

        // Ensure required fields have defaults
        $data['received_at'] = $data['received_at'] ?? now();
        $data['import_source'] = $data['import_source'] ?? 'csv';
        
        return $data;
    }

    protected function importUsers(string $content, bool $dryRun, bool $skipDuplicates): int
    {
        $this->info('Importing users...');
        
        preg_match('/INSERT INTO `users`[^;]+;/s', $content, $matches);
        
        if (empty($matches)) {
            $this->warn('No users found in SQL dump');
            return 0;
        }

        $insertStatement = $matches[0];
        
        preg_match('/INSERT INTO `users` \(([^)]+)\)/', $insertStatement, $colMatch);
        $columns = array_map(function($c) {
            return trim(str_replace('`', '', $c));
        }, explode(',', $colMatch[1]));

        preg_match_all('/\(([^)]+)\)(?:,|;)/', $insertStatement, $valueMatches, PREG_SET_ORDER);
        array_shift($valueMatches);

        $imported = 0;
        $skipped = 0;

        foreach ($valueMatches as $valueMatch) {
            try {
                $values = $this->parseValues($valueMatch[1]);
                $data = array_combine($columns, $values);
                
                unset($data['id']);
                
                foreach ($data as $key => $value) {
                    if ($value === 'NULL' || $value === '') {
                        $data[$key] = null;
                    }
                }

                if ($skipDuplicates && User::where('email', $data['email'])->exists()) {
                    $skipped++;
                    continue;
                }

                // Don't overwrite passwords - use a default
                $data['password'] = Hash::make('password');

                if (!$dryRun) {
                    User::create($data);
                }
                $imported++;
            } catch (\Exception $e) {
                $this->error("Error importing user: " . $e->getMessage());
            }
        }

        $this->info("Users: {$imported} imported, {$skipped} skipped");
        return 0;
    }

    protected function importProjects(string $content, bool $dryRun, bool $skipDuplicates): int
    {
        $this->info('Importing projects...');
        
        preg_match('/INSERT INTO `projects`[^;]+;/s', $content, $matches);
        
        if (empty($matches)) {
            $this->warn('No projects found in SQL dump');
            return 0;
        }

        $insertStatement = $matches[0];
        
        preg_match('/INSERT INTO `projects` \(([^)]+)\)/', $insertStatement, $colMatch);
        $columns = array_map(function($c) {
            return trim(str_replace('`', '', $c));
        }, explode(',', $colMatch[1]));

        preg_match_all('/\(([^)]+)\)(?:,|;)/', $insertStatement, $valueMatches, PREG_SET_ORDER);
        array_shift($valueMatches);

        $imported = 0;
        $skipped = 0;

        foreach ($valueMatches as $valueMatch) {
            try {
                $values = $this->parseValues($valueMatch[1]);
                $data = array_combine($columns, $values);
                
                unset($data['id']);
                
                foreach ($data as $key => $value) {
                    if ($value === 'NULL' || $value === '') {
                        $data[$key] = null;
                    }
                }

                if ($skipDuplicates && Project::where('code', $data['code'])->exists()) {
                    $skipped++;
                    continue;
                }

                if (!$dryRun) {
                    Project::create($data);
                }
                $imported++;
            } catch (\Exception $e) {
                $this->error("Error importing project: " . $e->getMessage());
            }
        }

        $this->info("Projects: {$imported} imported, {$skipped} skipped");
        return 0;
    }

    protected function importTeams(string $content, bool $dryRun, bool $skipDuplicates): int
    {
        $this->info('Importing teams...');
        
        preg_match('/INSERT INTO `teams`[^;]+;/s', $content, $matches);
        
        if (empty($matches)) {
            $this->warn('No teams found in SQL dump');
            return 0;
        }

        $insertStatement = $matches[0];
        
        preg_match('/INSERT INTO `teams` \(([^)]+)\)/', $insertStatement, $colMatch);
        $columns = array_map(function($c) {
            return trim(str_replace('`', '', $c));
        }, explode(',', $colMatch[1]));

        preg_match_all('/\(([^)]+)\)(?:,|;)/', $insertStatement, $valueMatches, PREG_SET_ORDER);
        array_shift($valueMatches);

        $imported = 0;
        $skipped = 0;

        foreach ($valueMatches as $valueMatch) {
            try {
                $values = $this->parseValues($valueMatch[1]);
                $data = array_combine($columns, $values);
                
                unset($data['id']);
                
                foreach ($data as $key => $value) {
                    if ($value === 'NULL' || $value === '') {
                        $data[$key] = null;
                    }
                }

                if ($skipDuplicates && Team::where('name', $data['name'])->where('project_id', $data['project_id'])->exists()) {
                    $skipped++;
                    continue;
                }

                if (!$dryRun) {
                    Team::create($data);
                }
                $imported++;
            } catch (\Exception $e) {
                $this->error("Error importing team: " . $e->getMessage());
            }
        }

        $this->info("Teams: {$imported} imported, {$skipped} skipped");
        return 0;
    }

    /**
     * Parse SQL values handling quoted strings and NULL values.
     */
    protected function parseValues(string $valueString): array
    {
        $values = [];
        $current = '';
        $inQuote = false;
        $escapeNext = false;

        for ($i = 0; $i < strlen($valueString); $i++) {
            $char = $valueString[$i];

            if ($escapeNext) {
                $current .= $char;
                $escapeNext = false;
                continue;
            }

            if ($char === '\\') {
                $escapeNext = true;
                continue;
            }

            if ($char === "'" && !$inQuote) {
                $inQuote = true;
                continue;
            }

            if ($char === "'" && $inQuote) {
                $inQuote = false;
                continue;
            }

            if ($char === ',' && !$inQuote) {
                $values[] = trim($current);
                $current = '';
                continue;
            }

            $current .= $char;
        }

        $values[] = trim($current);
        
        return $values;
    }
}
