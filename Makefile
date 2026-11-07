.PHONY: start stop test e2e seed lint

COMPOSE := docker compose

.env:
	@umask 077 && printf 'OVERLEAF_INVITE_TOKEN_SECRET=%s\n' "$$(openssl rand -base64 32)" > .env
	@echo ".env mit neuem OVERLEAF_INVITE_TOKEN_SECRET angelegt."

start: .env
	$(COMPOSE) up -d --wait

stop:
	$(COMPOSE) down

test:
	$(COMPOSE) exec sharelatex bash -lc 'cd /overleaf/services/web && yarn run vitest run modules/spur'

e2e:
	node services/web/modules/spur/test/e2e/run.mjs

seed:
	$(COMPOSE) exec sharelatex bash -lc 'cd /overleaf/services/web && node modules/spur/scripts/seed.mjs'

lint:
	yarn workspace @overleaf/web exec eslint modules/spur
