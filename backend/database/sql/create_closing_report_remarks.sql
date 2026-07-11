CREATE TABLE IF NOT EXISTS `closing_report_remarks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_date` DATE NOT NULL,
  `country` VARCHAR(50) NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `remarks` TEXT NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `closing_report_unique_row` (`report_date`, `country`, `project_id`),
  KEY `closing_report_country_date_idx` (`country`, `report_date`),
  KEY `closing_report_project_idx` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
