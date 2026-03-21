<?php

declare(strict_types=1);

use TaEdu\Api\Http\Http;
use TaEdu\Api\ImgBBClient;

$config = require __DIR__ . "/bootstrap.php";

$allowedOrigins = $config["allowed_origins"] ?? [];
Http::applyCors($allowedOrigins);
Http::finishOptions();
Http::requirePost();

$payload = Http::jsonBody();
if (empty($payload["dataUrl"])) {
  Http::fail("missing dataUrl", 400);
}

try {
  $client = new ImgBBClient($config["imgbb_key"] ?? "");
  $result = $client->uploadFromDataUrl(
    (string) $payload["dataUrl"],
    isset($payload["name"]) ? (string) $payload["name"] : null
  );

  Http::respond([
    "url" => $result["url"] ?? $result["display_url"] ?? null,
  ]);
} catch (\RuntimeException $e) {
  $message = $e->getMessage();
  $isConfigError = stripos($message, "not configured") !== false;
  Http::fail(
    $isConfigError ? "no_imggb_key" : "imgbb_failed",
    $isConfigError ? 500 : 502,
    ["detail" => $message]
  );
} catch (\Throwable $e) {
  Http::fail("server_error", 500, ["detail" => $e->getMessage()]);
}
