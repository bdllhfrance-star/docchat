# Résultats d’évaluation RAG en production

## Exécution

| Métadonnée | Valeur |
| --- | --- |
| Date | 2026-09-03 à 17:11 (Africa/Casablanca) |
| Environnement | Production Vercel |
| URL stable | <https://docchat-lyart.vercel.app/> |
| Commit évalué | `60f7579315734545f1b9092f792d70b3ce402df3` |
| Modèle | Gemini 3.7 Flash, raisonnement moyen |
| Services réels | Vercel, Vercel Blob, MongoDB Atlas Vector Search/Search, Gemini et Upstash |
| Fixtures | `tests/fixtures/documents/wikipedia-contribution-guide-fr.pdf` et `tests/fixtures/documents/wikipedia-classroom-booklet-ar.pdf` |

Cette exécution utilise les vrais services de production. Elle ne repose ni sur
un mock Gemini, ni sur un faux retrieval, ni sur les assertions Vitest.

## Méthode de scoring

Chaque résultat est noté sur 5 avec une grille simple et vérifiable :

- exactitude par rapport à la réponse attendue : 0 à 2 points ;
- document et localisation attendus présents dans les citations : 0 à 2 points ;
- langue attendue ou comportement de refus correct : 0 à 1 point.

Le score ci-dessous est une métadonnée QA. Il ne s’agit pas du score RRF ou de
similarité interne utilisé pour classer les chunks.

## Synthèse

| ID | Langue | Résultat | Source attendue vérifiée | Latence bout en bout | Score |
| --- | --- | --- | --- | ---: | ---: |
| `eval-fr-01` | Français | PASS | PDF français, page 4 | 7 934 ms | 5/5 |
| `eval-fr-02` | Français | PASS | PDF français, page 8 | 3 796 ms | 5/5 |
| `eval-ar-01` | Arabe | PASS | PDF arabe, page 2 | 4 319 ms | 5/5 |
| `eval-ar-02` | Arabe | PASS | PDF arabe, page 5 | 3 450 ms | 5/5 |
| `eval-absent-01` | Français | PASS | Refus sans citation | 3 873 ms | 5/5 |

**Résultat global : 5/5 cas réussis, 25/25 points, soit 100 %.** La latence
moyenne observée est de 4 674 ms. Elle mesure l’envoi de la question jusqu’à la
fin du stream telle qu’observée dans le navigateur.

## Résultats réels

### `eval-fr-01`

- **Question :** Quel est l’objectif principal de l’initiative Art+Féminisme ?
- **Réponse obtenue :** L’objectif principal est de réduire l’écart des genres
  et le manque de représentation sur Wikipédia, notamment en enrichissant le
  contenu consacré aux femmes cis et trans, aux personnes non-binaires, aux
  arts et au féminisme.
- **Citations observées :**
  `wikipedia-contribution-guide-fr.pdf` pages 4, 5 et 3.
- **Vérification :** la réponse attendue et la page 4 sont présentes.
- **Score :** exactitude 2/2, source 2/2, langue 1/1.

### `eval-fr-02`

- **Question :** Que recommande le guide en cas de conflit d’intérêts ?
- **Réponse obtenue :** Ne pas rédiger l’article soi-même et utiliser plutôt la
  page de discussion appropriée pour expliquer et suggérer les améliorations.
- **Citation observée :**
  `wikipedia-contribution-guide-fr.pdf`, page 8.
- **Vérification :** réponse et localisation identiques aux attentes.
- **Score :** exactitude 2/2, source 2/2, langue 1/1.

### `eval-ar-01`

- **Question :** ما هي ويكيبيديا؟
- **Réponse obtenue :** ويكيبيديا موسوعة إلكترونية مجانية ومفتوحة يمكن لأي
  شخص تحريرها، وهي متوفرة بأكثر من 300 لغة. La réponse continue en arabe en
  expliquant le projet de connaissance et sa communauté de bénévoles.
- **Citation principale observée :**
  `wikipedia-classroom-booklet-ar.pdf`, page 2.
- **Vérification :** réponse arabe correctement extraite, générée et affichée ;
  le document et la page attendus sont cités.
- **Score :** exactitude 2/2, source 2/2, langue 1/1.

### `eval-ar-02`

- **Question :** اذكر علامتين إيجابيتين تدلان على جودة مقالة ويكيبيديا.
- **Réponse obtenue :** وجود مراجع عديدة من مصادر موثوقة، ومحتوى متوازن ومنظم
  مكتوب من وجهة نظر محايدة. La réponse mentionne également une introduction
  claire et riche en informations parmi les autres indicateurs.
- **Citation observée :**
  `wikipedia-classroom-booklet-ar.pdf`, page 5.
- **Vérification :** les indicateurs attendus sont présents et correctement
  localisés.
- **Score :** exactitude 2/2, source 2/2, langue 1/1.

### `eval-absent-01`

- **Question :** Quel est le taux de TVA appliqué au Maroc en 2026 ?
- **Réponse obtenue :** Smartly.ai indique que cette information générale n’est
  pas fournie par les documents importés et redirige vers des assistants
  généralistes.
- **Citations observées :** aucune.
- **Vérification :** refus métier correct, sans inventer de taux ni de source.
- **Score :** exactitude/refus 2/2, absence de fausse citation 2/2, langue 1/1.

## Smoke test français/arabe

| Étape | Résultat | Preuve observée |
| --- | --- | --- |
| Upload multi-PDF | PASS | Les deux fixtures publiques ont été envoyées au Blob privé depuis une nouvelle session. |
| Extraction et indexation | PASS | Les deux documents ont atteint `Ready` et ont été inclus dans le contexte. |
| Q&A français | PASS | Deux réponses correctes avec citations pages 4 et 8. |
| Q&A arabe | PASS | Deux réponses en arabe avec citations pages 2 et 5. |
| Streaming | PASS | Chaque réponse a été reçue en stream et le composeur s’est réactivé à la fin. |
| Refus hors corpus | PASS | Aucun taux inventé et aucune citation documentaire affichée. |

## Défaut trouvé et corrigé pendant le smoke test

Le premier passage a révélé une condition de concurrence : deux callbacks
d’indexation terminés presque simultanément pouvaient laisser les deux documents
à `Ready` tout en régressant le batch vers `processing`. Le correctif
compare-et-échange les compteurs du batch avant chaque mise à jour, puis recalcule
en cas de concurrence. Il est couvert par un test déterministe et livré dans le
commit évalué ci-dessus. Après déploiement, le même lot de deux PDF a atteint
`Ready` et le chat s’est déverrouillé normalement.

