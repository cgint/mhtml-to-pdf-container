#!/bin/bash

docker compose up -d

sleep 3

curl -f -X POST -F file=@/Users/cgint/dev/mhtml-to-pdf-container/data/test.mht \
  http://localhost:9111/mht-to-pdf -o /Users/cgint/dev/mhtml-to-pdf-container/data/test-output.pdf