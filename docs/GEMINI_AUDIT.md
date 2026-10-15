# Audit de l'intégration Gemini — 15 octobre 2026

## Configuration retenue

| Élément | Configuration validée |
| --- | --- |
| Génération | `gemini-3.8-flash` stable |
| Raisonnement | `medium` |
| Fenêtre d'entrée | 1 048 576 tokens |
| Sortie maximale configurée | 65 536 tokens |
| Embeddings | `gemini-embedding-2`, 768 dimensions |
| Tâches d'embedding | `RETRIEVAL_DOCUMENT` et `RETRIEVAL_QUERY` |
| Authentification | Nouvelle clé d'autorisation AI Studio, variable serveur `GOOGLE_GENERATIVE_AI_API_KEY` |
| SDK conservés | `ai@7.0.90` et `@ai-sdk/google@4.0.62` |

## Changements depuis septembre

Google indique que `gemini-3.7-flash` est désormais un alias redirigé vers
`gemini-3.8-flash`. L'ancien endpoint répond encore, mais le code et l'interface
utilisent maintenant explicitement le modèle 3.8 pour éviter une configuration
et un affichage ambigus. Les limites de contexte et le niveau `medium` restent
compatibles.

Les nouvelles clés AI Studio sont des clés d'autorisation liées à un compte de
service. Le fournisseur Google de l'AI SDK installé les transmet déjà via
`x-goog-api-key` ; les tests réels ne nécessitent aucun remplacement de SDK.
La nouvelle clé est enregistrée uniquement dans `.env.local`, ignoré par Git.
Les variables de production Vercel ne sont pas modifiées par cette opération.

Le modèle d'embedding et sa dimension sont conservés : changer seulement la clé
et le modèle de génération ne nécessite pas de recalculer les vecteurs existants.
Un changement futur de modèle d'embedding imposerait une réindexation, même si la
dimension restait identique.

## Vérifications réelles effectuées

Les appels utilisent exclusivement de petits textes synthétiques, sans document
utilisateur. Aucun secret ni vecteur complet n'est inclus dans ce rapport.

| Vérification | Résultat |
| --- | --- |
| Liste des modèles avec la nouvelle clé | HTTP 200 ; Flash 3.8 et Embedding 2 disponibles |
| Génération via l'ancien alias 3.7 | Réponse non vide, fin `stop` |
| Streaming via Flash 3.8, raisonnement moyen | Réponse terminée avec `stop`, fait documentaire attendu et citation `[1]` présents |
| Embeddings de deux documents synthétiques français/arabe | Deux vecteurs de 768 nombres finis |
| Embedding d'une question arabe | Un vecteur de 768 nombres finis |

Ces vérifications prouvent le fonctionnement actuel de la nouvelle clé et des
SDK installés. Elles ne prouvent ni que l'ancienne clé est invalide, ni l'absence
de quotas sur le nouveau projet.
Les cinq évaluations de septembre restent des résultats historiques ; elles
ne sont pas présentées comme une nouvelle évaluation RAG complète de Flash 3.8.

## Santé initiale des services et validation locale (avant rétablissement)

| Vérification | Résultat |
| --- | --- |
| Vercel Blob privé | Lecture de métadonnées autorisée ; aucun fichier modifié |
| MongoDB Atlas | Résolution SRV impossible : `ENOTFOUND`, confirmée par `NXDOMAIN` auprès du DNS public Google |
| Upstash Redis | Résolution du domaine impossible : `ENOTFOUND`, confirmée par `NXDOMAIN` auprès du DNS public Google |
| Interface locale | HTTP accessible, affichage Gemini 3.8 Flash confirmé dans le navigateur |
| Tests automatisés | 289 tests réussis dans 46 fichiers |
| TypeScript et ESLint | Validés |

Les deux domaines manquants correspondent aux connexions actuellement présentes
dans `.env.local`. Cela peut indiquer des ressources supprimées ou des URLs
obsolètes ; le DNS seul ne permet pas de conclure à leur suppression. Leur état
doit être contrôlé dans Atlas et Upstash, puis les variables locales remplacées
si nécessaire. Aucune ressource cloud n'a été créée ou supprimée pendant l'audit.

**À ce stade initial, le parcours RAG complet était bloqué par ces deux dépendances**, malgré le bon
fonctionnement de Gemini et des tests automatisés. Ces derniers utilisent des
dépendances simulées pour les tests déterministes et ne prouvent pas l'état des
services cloud. Il faut rétablir Atlas et Upstash avant de refaire un smoke test
upload → indexation → question → citation.

## Rétablissement et vérification en production — 15 octobre 2026

- MongoDB Atlas rétabli et nouvelle configuration Redis validée : ping,
  écriture/lecture éphémère, puis création de batch en production (HTTP 201).
- Clés Gemini et Redis synchronisées dans l'environnement Production Vercel.
- Version locale CNOM déployée sur `https://docchat-lyart.vercel.app/`.
- Les deux index Atlas absents après restauration ont été recréés à partir de
  `src/lib/db/indexes.ts`, puis vérifiés `READY` et `queryable: true`.
- Lecture vectorielle et lexicale vérifiée sur les chunks existants, sans
  publier leurs contenus dans les résultats.
- Smoke test réel avec une fixture synthétique indexée : `/api/chat` HTTP 200,
  contenu attendu et citation `[1]`. Cette vérification couvre retrieval,
  construction du contexte et génération, **pas le callback d'upload**.
- Nouveau test immédiat, sans attendre le refresh Atlas : HTTP 200, un passage
  de type `context`, contenu attendu et citation `[1]`. Il valide le fallback
  borné sur les chunks stockés, toujours filtré par session/batch/documents.
- Les fixtures synthétiques de ces vérifications ont été supprimées ; aucun
  document utilisateur n'a été supprimé.
- 295 tests automatisés réussis dans 46 fichiers ; TypeScript, lint des fichiers
  modifiés et build Vercel validés.
- Un test ultérieur a validé le parcours complet d'upload privé avec callback,
  Q&A français/arabe/anglais et ajout/suppression : 19 contrôles réussis.
  Résultats et limites : [smoke test de production](PRODUCTION_SMOKE_2026-10-15.md).

Les états DNS négatifs ci-dessus sont historiques et ne décrivent plus la
configuration active. Les secrets partagés dans la conversation doivent encore
être renouvelés auprès de leurs fournisseurs : leur fonctionnement ne prouve
pas leur révocation ou leur rotation.

## Sources officielles

- [Clés Gemini et migration vers les clés d'autorisation](https://ai.google.dev/gemini-api/docs/api-key).
- [Calendrier et redirection de l'ancien modèle](https://ai.google.dev/gemini-api/docs/deprecations).
- [Capacités et limites de Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).
- [Gemini Embedding 2 et dimensions prises en charge](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2).
