#!/bin/bash

set -e


INPUT_FILE=/Users/cgint/dev/mhtml-to-pdf-container/data/test.mht
OUTPUT_FILE=/Users/cgint/dev/mhtml-to-pdf-container/data/test-output.pdf
OUTPUT_FILE_BUNNY=/Users/cgint/dev/mhtml-to-pdf-container/data/test-output-bunny.pdf

# Allow overriding input file with command line argument
if [ "$1" ]; then
    INPUT_FILE="$1"
fi

echo
echo "Using input file: $INPUT_FILE"

docker compose up -d --build --remove-orphans

echo "Waiting for container to be ready..."
sleep 3

echo "Converting test.mht..."
curl -f -X POST -F file=@$INPUT_FILE http://localhost:9111/mht-to-pdf -o $OUTPUT_FILE

echo "Done!"

echo
echo Testing deployed endpoint on bunny.net in the background ...
curl -f -X POST -F file=@$INPUT_FILE https://mc-wogbsinf6n.bunny.run/mht-to-pdf -o $OUTPUT_FILE_BUNNY
