# Vérification réelle en production — 15 octobre 2026

Application : https://docchat-lyart.vercel.app/

Version applicative : `c3a0164` (mêmes sources applicatives que le déploiement
CLI testé ; le script et ce rapport sont ajoutés dans le commit suivant).

Exécution : **23:48:16 à 23:48:56, Africa/Casablanca (UTC+1)**.
Le script journalise les timestamps ISO en UTC.

## Résultat

**19 contrôles sur 19 réussis**, puis trois suppressions de nettoyage HTTP 204.
Ce sont des appels réseau réels, pas des mocks. Le test utilise l'API publique,
un nouveau cookie anonyme, l'upload privé Blob avec son callback serveur,
l'extraction, les embeddings, MongoDB/Atlas, Redis et le streaming Gemini.
Aucun statut Ready ni vecteur n'est injecté directement en base dans ce test.

| Contrôle | Résultat observé |
| --- | --- |
| Création d'un batch isolé | HTTP 201 |
| Upload PDF français, PDF arabe et TXT | Trois uploads privés réussis |
| Callback et ingestion | Trois documents Ready |
| Q&A français | Objectif Art+Féminisme correctement identifié et citations présentes ; 3 872 ms |
| Q&A arabe | Définition de Wikipédia en arabe, citation de la page 2 ; 6 073 ms |
| Q&A anglais/TXT | Code TXT-7319 et délai de 30 jours, citation lignes 1–7 ; 2 526 ms |
| Message social « hello » | Salutation naturelle, aucune source |
| Ajout d'un Markdown au même batch | HTTP 201, upload privé puis quatre documents Ready |
| Nouveau document dans le contexte | Nadia Benali et 4 heures avec citation |
| Suppression du nouveau document | HTTP 204, retour à trois documents |
| Q&A après suppression, ancienne réponse dans l'historique | Le modèle indique l'absence du document Operations ; aucune source supprimée ni réutilisation de « Nadia » |
| Ancien identifiant sélectionné après suppression | HTTP 404 |
| Lecture du batch sans cookie | HTTP 401 |
| Nettoyage | Suppression des trois documents de test restants via l'API, HTTP 204 chacun |

## Extraits vérifiés

- Français : réduction de l'écart des genres sur Wikipédia et meilleure
  représentation des femmes, personnes non-binaires, du féminisme et des arts.
- Arabe : « موسوعة مجانية » ; la réponse décrit une encyclopédie gratuite
  modifiable par chacun et disponible dans plus de 300 langues.
- Anglais : « Approval code: TXT-7319 [1] » et « Payment window: 30 days [1] ».
- Après suppression : « The currently uploaded documents do not contain an
  Operations document or any information regarding escalation ownership and
  target response times. »

Les PDF sont les fixtures librement licenciées déjà référencées dans
`tests/fixtures/README.md`. Les fichiers TXT et MD sont synthétiques.
Le test ne lit ni ne supprime de documents utilisateur.

## Reproduction et portée

```bash
node tests/production-smoke.mjs
```

Le script n'a pas besoin de secrets : il passe par les mêmes endpoints et le
même mécanisme de client upload que l'interface. Il consomme des requêtes
Gemini/Redis/Blob réelles et supprime uniquement les documents qu'il crée.
La variable optionnelle `SMOKE_BASE_URL` permet de cibler un autre déploiement.
Éviter les exécutions simultanées depuis la même IP pour respecter le rate limit.

Il valide les données de citation et leurs localisations, mais **pas** les clics
dans le navigateur, le rendu visuel, ni les sept formats dans cette exécution.
Les formats testés ici sont PDF (FR/AR), TXT et Markdown.
Il s'agit d'un smoke test à assertions ciblées, pas d'une mesure exhaustive de
qualité ou d'une garantie d'absence de défauts. La suite déterministe comprend
295 tests dans 46 fichiers ; les évaluations de septembre restent historiques.

## Sécurité restante

La rotation des clés Gemini, Redis et QStash partagées dans la conversation
reste à effectuer dans les consoles des fournisseurs. Leur valeur ne figure
ni dans ce rapport, ni dans le script, ni dans Git. Les tokens applicatifs
disponibles ne donnent pas accès à la gestion des clés des comptes fournisseurs.
