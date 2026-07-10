# GitHub — podpięcie repozytorium

## 1. Utwórz repo na GitHub

- Nazwa: `loopforge` (lub `loopforge-app`)
- **Private** (projekt zamknięty na start)
- Bez README / .gitignore z GitHuba (mamy lokalnie)

## 2. Podłącz remote

```bash
cd /Users/michal/Sites/loopforge

git remote add origin git@github.com:MichalKozlowski2017/loopforge.git
# lub HTTPS:
# git remote add origin https://github.com/MichalKozlowski2017/loopforge.git
```

## 3. Pierwszy push

```bash
git add .
git commit -m "Initial commit: docs and project scaffold"
git branch -M main
git push -u origin main
```

## 4. Vercel (Faza 1)

1. Import projektu z GitHub w Vercel
2. Root directory: `apps/web` (gdy Next.js będzie w monorepo)
3. Framework: Next.js
4. Env vars z `docs/setup.md`

## 5. Otwórz w Cursor

File → Open Folder → `/Users/michal/Sites/loopforge`

Lub po pushu: `git clone` na drugiej maszynie.
