<?php

declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');
$available = function_exists('curl_init');

echo $available
  ? "cURL extension is available." . PHP_EOL
  : "cURL extension is missing." . PHP_EOL;
