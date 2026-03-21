<?php

declare(strict_types=1);

namespace TaEdu\Api;

use RuntimeException;

final class ImgBBClient
{
  private string $apiKey;
  private string $endpoint;

  public function __construct(string $apiKey, string $endpoint = "https://api.imgbb.com/1/upload")
  {
    $apiKey = trim($apiKey);
    if ($apiKey === "") {
      throw new RuntimeException("IMGBB_KEY not configured");
    }

    $this->apiKey = $apiKey;
    $this->endpoint = rtrim($endpoint, "/");
  }

  public function uploadFromDataUrl(string $dataUrl, ?string $name = null): array
  {
    $base64 = $this->normalizePayload($dataUrl);

    $fields = http_build_query([
      "image" => $base64,
      "name"  => $name ?: ("kyc-" . time()),
    ]);

    $url = $this->endpoint . "?key=" . urlencode($this->apiKey);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_POST => true,
      CURLOPT_POSTFIELDS => $fields,
      CURLOPT_RETURNTRANSFER => true,
    ]);

    $response = curl_exec($ch);
    $error = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
      throw new RuntimeException($error ?: "ImgBB request failed");
    }

    $json = json_decode($response, true);
    if (empty($json["success"])) {
      $message = $json["error"]["message"] ?? "ImgBB rejected the upload";
      throw new RuntimeException($message);
    }

    return $json["data"] ?? [];
  }

  private function normalizePayload(string $dataUrl): string
  {
    if (strpos($dataUrl, "base64,") !== false) {
      $parts = explode("base64,", $dataUrl);
      return end($parts) ?: "";
    }

    return $dataUrl;
  }
}
