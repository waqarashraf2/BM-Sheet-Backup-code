<?php
error_reporting(E_ALL);
ini_set('display_errors',1);
header('Content-Type: text/plain');
try{
$p=new PDO('mysql:host=localhost;dbname=crmbenchmarkstud_bmdb','crmbenchmarkstud_bmuser','Benchmark@2026!');
$p->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
$c=$p->query("SHOW COLUMNS FROM crm_order_assignments")->fetchAll(PDO::FETCH_COLUMN);
echo "Before: ".implode(',',$c)."\n";
$add=['drawer_done VARCHAR(10) NULL','checker_done VARCHAR(10) NULL','final_upload VARCHAR(10) NULL','drawer_date DATETIME NULL','checker_date DATETIME NULL','ausFinaldate DATETIME NULL'];
foreach($add as $a){$n=explode(' ',$a)[0];if(!in_array($n,$c)){$p->exec("ALTER TABLE crm_order_assignments ADD COLUMN $a");echo "Added $n\n";}else{echo "Has $n\n";}}
$c2=$p->query("SHOW COLUMNS FROM crm_order_assignments")->fetchAll(PDO::FETCH_COLUMN);
echo "After: ".implode(',',$c2)."\n";
}catch(Exception $e){echo "ERR: ".$e->getMessage();}
@unlink(__FILE__);
