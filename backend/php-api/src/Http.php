<?php

declare(strict_types=1);

namespace TaEdu\Api\Http;

/**
 * Basic HTTP helpers for the lightweight PHP endpoints.
 */
final class Http
{
  /**
   * Apply CORS headers and normalize the incoming origin.
   *
   * @return string the origin that is finally allowed (for debugging/tests)
   */
  public static function applyCors(array $allowedOrigins, array $allowedHeaders = [], array $allowedMethods = []): string
  {
    $allowedHeaders = $allowedHeaders ?: ["Content-Type", "Authorization"];
    $allowedMethods = $allowedMethods ?: ["POST", "OPTIONS"];

    $origin = $_SERVER["HTTP_ORIGIN"] ?? "*";
    if ($origin !== "*" && !in_array($origin, $allowedOrigins, true)) {
      $origin = $allowedOrigins[0] ?? "*";
    }

    header("Access-Control-Allow-Origin: " . $origin);
    header("Vary: Origin");
    header("Access-Control-Allow-Headers: " . implode(", ", $allowedHeaders));
    header("Access-Control-Allow-Methods: " . implode(", ", $allowedMethods));
    header("Content-Type: application/json; charset=utf-8");

    return $origin;
  }

  public static function finishOptions(): void
  {
    if (self::requestMethod() === "OPTIONS") {
      http_response_code(204);
      exit;
    }
  }

  public static function requirePost(): void
  {
    if (self::requestMethod() !== "POST") {
      self::fail("method_not_allowed", 405);
    }
  }

  public static function jsonBody(): array
  {
    $raw = file_get_contents("php://input") ?: "";
    $decoded = json_decode($raw, true);

    return is_array($decoded) ? $decoded : [];
  }

  public static function fail(string $error, int $status = 400, array $extra = []): void
  {
    $payload = array_merge(["error" => $error], $extra);
    self::respond($payload, $status);
  }

  public static function respond(array $payload, int $status = 200): void
  {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
  }

  private static function requestMethod(): string
  {
    return strtoupper($_SERVER["REQUEST_METHOD"] ?? "");
  }
}
