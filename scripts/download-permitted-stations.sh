#!/usr/bin/env bash
# Download the Knowledgebase fare group permitted stations from the Rail Data Marketplace bucket.
#
#   scripts/download-permitted-stations.sh [directory]
#
# Credentials come from .env, or the environment: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. The file is written to the
# directory given, data/ by default, where build-splits can be pointed at it with --permitted-stations or which can be
# the fares directory so it is found without.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

BUCKET="s3://gb-rail-rdm-008439054684"
export AWS_REGION="${AWS_REGION:-eu-west-2}"
FILE="FareGroupPermittedStations_v1.0.xml"
DIRECTORY="${1:-data}"

mkdir -p "$DIRECTORY"
aws s3 cp --no-progress "$BUCKET/$FILE" "$DIRECTORY/$FILE"
