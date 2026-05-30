<?php
$pids = \App\Models\Project::where("status","active")->pluck("id");
echo "Projects: " . $pids->implode(",") . "\n";
foreach($pids as $p){
    $t="project_{$p}_orders";
    if(!\Schema::hasTable($t)){echo "NO_TABLE $p "; continue;}
    $cnt = \DB::table($t)->count();
    echo "$p:$cnt ";
    try{\DB::statement("CREATE INDEX idx_delivered_at ON $t (delivered_at)");echo "+d ";}catch(\Exception $e){echo "=d ";}
    try{\DB::statement("CREATE INDEX idx_received_at ON $t (received_at)");echo "+r ";}catch(\Exception $e){echo "=r ";}
}
echo "\nDONE\n";
