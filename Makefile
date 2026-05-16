.PHONY: install
install:
	npm install --no-save @playwright/test
	npx playwright install chromium

.PHONY: all
all: format test

.PHONY: format
format:
	npx --yes prettier --write . --log-level=silent

.PHONY: test
test: install
ifdef CI
	npx playwright test --grep-invert "@snapshot"
else
	npx playwright test
endif

snapshots: install
	npx playwright test --grep "@snapshot"

.PHONY: dev
dev: install
	npx --yes nodemon --ext js,mjs,json,html,css --watch . --exec "clear; make all; printf '\n🚀\n\n'"

.PHONY: run
run:
	npx --yes live-server --no-browser --ignorePattern='test-results|tests/snapshots'

.PHONY: icons
icons:
	@set -e; cd images; SVG=grand-rapids-city-logo.svg; BG='#f8e119'; \
	rsvg-convert -w 720 -h 720 -b "$$BG" "$$SVG" | magick - -filter Lanczos -resize 180x180 apple-touch-icon.png; \
	rsvg-convert -w 768 -h 768 -b "$$BG" "$$SVG" | magick - -filter Lanczos -resize 192x192 icon-192.png; \
	rsvg-convert -w 2048 -h 2048 -b "$$BG" "$$SVG" | magick - -filter Lanczos -resize 512x512 icon-512.png; \
	rsvg-convert -w 128 -h 128 -b "$$BG" "$$SVG" | magick - -filter Lanczos -resize 32x32 favicon-32.png; \
	rsvg-convert -w 64 -h 64 -b "$$BG" "$$SVG" | magick - -filter Lanczos -resize 16x16 favicon-16.png

.PHONY: data
data:
	python scripts/fetch_car_parking_arcgis.py
	python scripts/fetch_car_parking_osm.py
	python scripts/fetch_car_parking_ellis.py
	python scripts/fetch_bike_parking.py
	python scripts/fetch_lime_parking.py
