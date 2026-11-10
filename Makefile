.PHONY: start update stop test e2e seed lint

COMPOSE := docker compose

.env:
	@umask 077 && printf 'OVERLEAF_INVITE_TOKEN_SECRET=%s\n' "$$(openssl rand -base64 32)" > .env
	@echo ".env mit neuem OVERLEAF_INVITE_TOKEN_SECRET angelegt."

# Holt vorher das aktuelle Image; ohne Netz startet das vorhandene.
start: .env
	$(COMPOSE) pull --ignore-pull-failures
	$(COMPOSE) up -d --wait

update: .env
	$(COMPOSE) pull
	@echo "Neue Images geholt. Jetzt startet spur mit docker compose up -d --wait neu."
	@echo "Ein Backup der Volumes spur_data und spur_mongo vorher ist sinnvoll, siehe README, Abschnitt Backup."
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
