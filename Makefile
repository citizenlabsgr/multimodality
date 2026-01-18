.PHONY: install
install:
	npm install --no-save @playwright/test
	npx playwright install chromium

.PHONY: all
all: format test

.PHONY: format
format:
	npx --yes prettier --write .

.PHONY: test
test: install
	npx playwright test

.PHONY: run
run:
	npx --yes live-server --no-browser
