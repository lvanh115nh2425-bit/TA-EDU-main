<?php

declare(strict_types=1);

return [
  "imgbb_key" => getenv("IMGBB_KEY") ?: "f2e8414c6c742db53171d7bb7c66c085",
  "allowed_origins" => [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://172.20.10.13:5500",
    "https://huongsaccodo.io.vn"
  ],
];
