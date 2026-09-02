# DocChat - Référence de développement

> Version 1.0 · 2 septembre 2026 · Périmètre de référence avant implémentation
> fonctionnelle

## 1. Rôle de ce document

Ce document est la source de vérité du projet DocChat. Il fixe le périmètre,
les objectifs, les user stories, les décisions techniques, le plan de travail
et les critères de fin.

Règles d'utilisation :

- Toute modification du périmètre doit être inscrite ici avant d'être codée.
- Une décision prise dans ce document prévaut sur une supposition d'un agent IA.
- Les agents ne doivent pas ajouter une dépendance, un service ou une abstraction
  qui ne répond pas à une exigence identifiée ici.
- Les petites tâches d'une même grande phase sont intégrées sans commit séparé.
- Chaque grande phase est entièrement vérifiée, puis reçoit un commit atomique
  et un résumé utilisateur avant le passage à la phase suivante.
- Les optimisations sont motivées par une limite observée ou une mesure.

## 2. Vision du produit

DocChat est une application web full stack permettant à un utilisateur de
sélectionner plusieurs documents en une fois, de suivre leur traitement, puis
de poser des questions sur tout ou partie de ces documents. Les réponses sont
générées par un LLM uniquement à partir des passages retrouvés par un pipeline
RAG et sont affichées progressivement avec leurs sources.

## 3. Objectifs

### 3.1 Objectif principal

Livrer en une journée de réalisation une application déployée sur Vercel,
testable sans installation et accompagnée d'un repository GitHub propre.

### 3.2 Objectifs fonctionnels

- Sélectionner plusieurs fichiers dans une seule opération.
- Vérifier le format et les limites de chaque fichier avant l'upload.
- Traiter les fichiers indépendamment au sein d'un même batch.
- Extraire et normaliser le contenu de plusieurs formats.
- Découper le contenu en chunks traçables vers leur source.
- Générer et persister les embeddings.
- Rechercher les passages pertinents dans les documents sélectionnés.
- Répondre uniquement à partir de ces passages.
- Afficher la réponse en streaming côté frontend.
- Afficher le fichier, l'emplacement, l'extrait et le score de chaque source.
- Continuer le batch lorsqu'un fichier échoue et permettre sa relance.
- Ne déclarer un fichier `ready` qu'après upload, extraction, chunking,
  génération des vecteurs et persistance complète dans MongoDB Atlas.
- Bloquer le chat jusqu'à ce que tous les fichiers conservés dans la session
  soient `ready`.

### 3.3 Objectifs qualité

- TypeScript strict sur tout le projet.
- API REST claire, documentée et correctement sécurisée.
- Erreurs structurées et compréhensibles.
- Code simple, lisible et défendable en entretien.
- Tests ciblés sur les comportements à risque.
- Commits atomiques avec des messages explicites.
- README complet avec architecture, compromis et résultats d'évaluation.

## 4. Périmètre

### 4.1 Priorités de livraison

| Priorité | Contenu | Règle de livraison |
| --- | --- | --- |
| P0 - Obligatoire | PDF natif, upload sécurisé, extraction, chunking, embeddings, recherche cosinus, chat fondé sur les documents, refus explicite, historique de session, sources et scores, API, streaming, TypeScript strict et déploiement Vercel. | Doit être déployé et testé avant toute extension. |
| P1 - Bonus retenus | Multi-PDF, recherche hybride, rate limiting, logs structurés, tests, français/arabe et jeu d'évaluation. | Fait partie de l'objectif de la journée, sans fragiliser P0. |
| P2 - Extension décidée | DOCX, PPTX, XLSX, TXT, Markdown et CSV dans le même batch. | Ne doit jamais bloquer P0, P1 ou le déploiement. |

Le projet vise P0, P1 et P2 dans la journée. Cette priorité ne retire aucun
objectif : elle détermine uniquement l'ordre d'intégration et protège une base
fonctionnelle si un format supplémentaire révèle un problème imprévu.

### 4.2 Inclus

- Application Next.js unique avec frontend et backend séparés logiquement.
- Upload batch déclenché par une seule action utilisateur.
- Formats modernes : PDF, DOCX, PPTX, XLSX, TXT, Markdown et CSV.
- Documents PDF à texte natif en français et en arabe.
- Chat multi-documents avec sélection des documents interrogés.
- Streaming de la réponse du LLM.
- Sources et scores de similarité.
- Recherche vectorielle puis recherche hybride.
- Rate limiting, logs structurés, tests et jeu d'évaluation.
- Session anonyme sans création de compte.

### 4.3 Hors périmètre initial

- Formats binaires historiques `.doc`, `.ppt` et `.xls`.
- Formats Office contenant des macros (`.docm`, `.pptm`, `.xlsm`).
- OCR des documents scannés et extraction du texte contenu dans des images.
- Fichiers protégés par mot de passe.
- Authentification, comptes utilisateur et rôles.
- Collaboration temps réel entre utilisateurs.
- Application mobile native.
- Back-office d'administration.
- Entraînement ou fine-tuning d'un modèle.
- Conservation permanente des fichiers.
- Worker, queue ou microservice tant qu'un timeout réel ne le justifie pas.

### 4.4 Limites initiales

| Limite | Valeur |
| --- | ---: |
| Fichiers par batch | 10 |
| Taille par fichier | 10 Mo |
| Taille totale du batch | 50 Mo |
| Pages par PDF | 50 |
| Slides par PPTX | 100 |
| Cellules non vides par XLSX | 50 000 |
| Traitements simultanés | 2 au départ, 3 si les mesures le permettent |
| Conservation des données de démonstration | 7 jours |

## 5. Utilisateurs

### 5.1 Utilisateur principal

Une personne qui souhaite interroger rapidement un ensemble de documents sans
installer de logiciel ni comprendre le fonctionnement du RAG.

### 5.2 Évaluateur technique

Un membre de Smartly.ai qui doit pouvoir tester l'application, inspecter les
sources, provoquer des erreurs, consulter le repository et comprendre les choix
techniques.

### 5.3 Développeur ou relecteur

Une personne qui clone le repository, configure les variables d'environnement,
lance les tests et vérifie le pipeline localement.

## 6. User stories et critères d'acceptation

| ID | User story | Critères d'acceptation essentiels |
| --- | --- | --- |
| US-01 | En tant qu'utilisateur, je sélectionne plusieurs documents en une fois. | Le sélecteur accepte plusieurs fichiers supportés et affiche toute la sélection avant l'upload. |
| US-02 | Je veux connaître les fichiers non acceptés avant l'upload. | Le type, la taille individuelle et la taille totale sont vérifiés, avec un message par fichier. Cette vérification préliminaire ne signifie pas que le fichier est déjà `ready`. |
| US-03 | Je lance le traitement de tout le batch avec une seule action. | Le bouton `Upload`, placé sous la liste des documents, crée le batch et démarre automatiquement les uploads autorisés. |
| US-03B | Je modifie ensuite le contexte sans repartir de zéro. | Après sélection, les nouveaux fichiers sont automatiquement envoyés et indexés dans le batch existant. Chaque document peut être supprimé individuellement avec ses chunks. La liste entière n'est jamais remplacée. |
| US-04 | Je veux suivre le traitement de chaque fichier. | Chaque fichier affiche `queued`, `uploading`, `validating`, `extracting`, `chunking`, `embedding`, `indexing`, `ready` ou `failed`. |
| US-05 | Je veux que les autres fichiers continuent lorsqu'un fichier échoue. | Un échec est isolé. Le chat reste bloqué jusqu'à ce que le fichier soit relancé avec succès ou supprimé. Un autre fichier peut ensuite être ajouté au même contexte. |
| US-06 | Je pose une question après la préparation complète du batch. | Le chat est activé seulement s'il existe au moins un document `ready` et qu'aucun document conservé n'est en traitement ou en échec. Tous les documents prêts sont sélectionnés par défaut. |
| US-07 | Je choisis les documents utilisés pour une question. | Le backend filtre réellement le retrieval par les `documentId` fournis. |
| US-08 | Je vois la réponse au fur et à mesure. | Le contenu apparaît progressivement sans attendre la réponse LLM complète. |
| US-09 | Je peux vérifier l'origine d'une réponse. | Chaque réponse présente le fichier, l'emplacement, un extrait et le score. |
| US-10 | Je ne veux pas de réponse inventée. | Si le contexte est insuffisant, l'assistant indique que l'information n'est pas présente. |
| US-11 | Je conserve le fil de la conversation pendant ma session. | Les questions et réponses restent visibles jusqu'à la fin de la session. |
| US-12 | Je peux retirer un document. | Le document, ses chunks et son fichier sont supprimés ou marqués pour suppression de façon cohérente. |
| US-13 | En tant qu'évaluateur, je peux vérifier les erreurs API. | Les codes HTTP et les corps d'erreur sont cohérents et documentés. |
| US-14 | Je peux interroger des PDF français et arabes. | L'extraction, le retrieval et la réponse fonctionnent sur les fixtures prévues. |
| US-15 | En tant que développeur, je peux reproduire le projet. | Le README documente l'installation, les variables, les index et les commandes de test. |
| US-16 | Je peux utiliser l'application avec un thème sombre. | Un contrôle dans l'en-tête bascule toute l'interface entre clair et sombre. Le choix est mémorisé localement et le thème système est utilisé par défaut. |

## 7. Correspondance avec le cahier des charges

| Exigence | Couverture prévue |
| --- | --- |
| F1 - Upload PDF | Upload batch étendu à plusieurs formats, validation et progression par étape. |
| F2 - Pipeline RAG | Extraction, chunking justifié, embeddings Gemini, persistance et recherche cosinus. |
| F3 - Chat Q&A | Historique de session, réponses limitées au contexte et refus explicite. |
| F4 - Sources | Extrait, fichier, emplacement et score pour chaque réponse. |
| F5 - API REST | `POST /api/upload`, `POST /api/chat` et endpoints complémentaires documentés. |
| F6 - Streaming | Réponse LLM transmise progressivement au frontend. |

Bonus retenus :

- Multi-documents.
- Recherche hybride vectorielle et full-text avec fusion RRF.
- Justification de ne pas utiliser LangChain ou LlamaIndex.
- Rate limiting et logging structuré.
- Tests unitaires, intégration et end-to-end ciblés.
- PDF français et arabes.
- Jeu d'évaluation de cinq questions et réponses.

Le reranking par LLM n'est ajouté que si l'évaluation montre un gain mesurable,
car la recherche hybride satisfait déjà l'exigence correspondante.

## 8. Architecture retenue

### 8.1 Direction visuelle

L'interface s'inspire de la clarté et de la sobriété de ChatGPT sans en être
une copie. Elle doit paraître professionnelle, calme et construite pour la
lecture : hiérarchie typographique nette, espaces généreux, palette neutre,
contraste accessible et un seul accent visuel principal.

Principes obligatoires :

- Aucun effet « AI UI » générique dans les contrôles ou le chat. La seule
  exception est la visualisation pédagogique centrale du pipeline : sa grille,
  ses gradients et ses halos représentent le passage des fichiers aux vecteurs.
- Les icônes sont des SVG Lucide simples, toujours accompagnés d'un texte
  lorsque leur sens n'est pas évident.
- La marque du header utilise l'icône bleue Smartly.ai avec le nom écrit en
  noir en thème clair et en blanc en thème sombre, sans sous-titre adjacent.
  La même icône sert de favicon et les métadonnées identifient clairement
  Smartly.ai dans l'onglet et les aperçus de partage.
- Les animations expliquent une opération réelle et ne servent pas à remplir
  l'attente artificiellement.
- L'état est compréhensible sans dépendre uniquement de la couleur.
- Le parcours fonctionne au clavier, sur mobile et avec un lecteur d'écran.

### 8.2 Parcours et règle de déblocage du chat

```text
Ouverture de l'application
→ création d'une session anonyme
→ ajout de documents depuis le panneau Documents à gauche
→ sélection et vérification préliminaire
→ bouton Upload sous la liste pour envoyer le batch
→ traitement et animation indépendante de chaque fichier
→ résolution des éventuels échecs
→ tous les fichiers conservés sont ready
→ activation du chat
→ ajout ou suppression ultérieure de documents sans remplacer le batch
→ sélection d'un nouveau fichier puis mise à jour automatique du contexte
→ réponse streamée avec sources
```

Le champ de message reste visible mais désactivé pendant la préparation, avec
une explication claire. La condition fonctionnelle est :

```ts
const canSendMessage =
  readyFiles > 0 && processingFiles === 0 && failedFiles === 0;
```

Dans ce projet, un fichier affiché comme **Prêt** ou « validé » a réussi toute
la chaîne suivante :

```text
Upload complet
→ vérification serveur
→ extraction du texte
→ création des chunks
→ génération des embeddings
→ écriture des chunks et vecteurs dans MongoDB Atlas
→ document vérifié comme interrogeable
→ statut ready
```

Un upload réussi ne suffit donc jamais à afficher l'icône verte. Si une étape
échoue, le fichier passe à `failed`, même si son original existe déjà dans
Blob. L'utilisateur peut alors :

- **Réessayer** : reprendre le traitement à partir du fichier déjà uploadé
  lorsque celui-ci est exploitable.
- **Supprimer** : retirer le fichier, ses métadonnées et ses éventuels chunks.

Les autres fichiers continuent leur traitement après un échec, mais le chat
reste bloqué jusqu'à sa résolution. Si le fichier échoué est supprimé et qu'au
moins un autre fichier est `ready`, le chat est activé. Si aucun fichier ne
reste, l'interface revient à l'état initial. L'ajout ultérieur d'un fichier à
une session de chat rebloque temporairement l'envoi des messages jusqu'à la fin
de son traitement.

### 8.3 Composition de l'interface

- **Panneau Documents** : toutes les actions documentaires sont centralisées à
  gauche — sélection, drag-and-drop, upload initial, ajout, retrait, retry et
  suppression — avec les titres et explications `Start`/`Review` associés. La
  ligne compacte des formats et limites acceptés y est affichée une seule fois.
- **Surface centrale avant le chat** : aucun bouton ni dropzone documentaire.
  Elle est réservée à la visualisation pédagogique du pipeline, à son état et
  à une courte description métier. La vue initiale affiche une signature
  compacte `Powered by Gemini` avec le modèle réellement configuré et ses
  paramètres utiles : contexte, sortie maximale et niveau de raisonnement.
- **Préparation** : liste des fichiers sélectionnés avec nom, format, taille,
  erreur locale éventuelle et action de retrait.
- **Traitement** : une ligne stable par fichier avec animation, libellé de
  l'étape réelle et actions disponibles.
- **Chat prêt** : panneau de documents compact à gauche et grande visualisation
  pédagogique du pipeline au centre tant qu'aucun message n'existe ; elle est
  remplacée par la conversation dès le premier échange. Le panneau devient un
  tiroir sur mobile.
- **Toile continue** : la grille et le gradient couvrent toute la surface de
  conversation, y compris derrière le composer, sans bande blanche ni bordure
  de séparation. Après le premier message, la conversation se pose sur cette
  même toile au lieu de remplacer son arrière-plan.
- **Information non répétée** : le panneau gauche ne contient pas un second
  bloc `Session limits`; les formats et limites sont affichés une seule fois
  dans la surface centrale avant la conversation.
- **Composer** : fixé au bas de la zone de conversation, désactivé avec une
  raison visible tant que `canSendMessage` vaut `false`.
- **Mutation du contexte** : pendant un retry ou une suppression, la zone de
  conversation reste montée sans flash vers le sélecteur. Seul le composer est
  temporairement verrouillé jusqu'à confirmation du nouveau contexte.
- **Sources** : présentées sous la réponse dans une liste compacte et
  dépliable, avec fichier, emplacement, extrait et score.

### 8.4 Animations manuelles et personnalisées

Les animations sont écrites dans le projet avec CSS, transitions React et SVG.
Aucune bibliothèque telle que Framer Motion n'est ajoutée. Chaque animation
correspond à l'opération qu'elle représente :

| Opération | Animation prévue |
| --- | --- |
| Ajout à la sélection | La ligne apparaît par un court fondu et un déplacement vertical de quelques pixels. |
| Vérification préliminaire | Un trait SVG parcourt brièvement l'icône du document, puis laisse apparaître le résultat. |
| Upload | Une barre déterminée suit les octets réellement envoyés ; l'icône de fichier monte très légèrement pendant le transfert. |
| Vérification serveur | Le contour SVG du document est parcouru une fois, avec le libellé `Vérification`. |
| Extraction | Trois lignes de texte apparaissent successivement depuis l'icône du document. |
| Chunking | Les lignes se séparent doucement en petits groupes ordonnés, sans particules décoratives. |
| Embeddings | Les groupes de texte se transforment en une courte rangée de points alignés représentant le vecteur. |
| Indexation | Les points se rangent dans une pile stable avant la validation finale. |
| Prêt | Le chemin du check SVG vert se dessine une fois, suivi d'une légère mise à l'échelle. |
| Échec | L'icône rouge apparaît avec un seul mouvement horizontal court ; aucune animation répétitive. |
| Réessayer | La flèche SVG effectue une rotation unique puis l'étape active reprend. |
| Supprimer | La ligne s'estompe puis se replie proprement sans déplacer brutalement la liste. |
| Replay pédagogique du pipeline | Tant que le chat est vide, six scènes rejouent en boucle `Upload → Validate → Extract → Chunk → Embed → Index`. Chaque étape reste mise en avant environ 2,2 secondes et contient plusieurs éléments animés représentant l'opération. La grille, le gradient et les halos couvrent toute la zone de conversation sans carte extérieure. Le badge `Process replay` évite de présenter cette démonstration comme une progression réelle. |
| Streaming du chat | Le texte se complète naturellement ; aucun faux curseur animé si aucun nouveau delta n'arrive. |

Règles d'implémentation des animations :

- Durée habituelle de 150 à 300 ms pour les transitions d'interface.
- Animations d'attente lentes, discrètes et limitées à la ligne concernée.
- Le replay central est la seule animation pédagogique persistante ; il disparaît
  dès que la conversation contient un message.
- `transform` et `opacity` privilégiés pour préserver les performances.
- Progression réelle pour l'upload ; aucune fausse valeur en pourcentage pour
  l'extraction, le chunking, les embeddings ou l'indexation.
- Libellé d'étape toujours affiché, même lorsque l'animation est visible.
- `prefers-reduced-motion` désactive les déplacements et conserve les changements
  d'état instantanés.
- `aria-live="polite"` annonce le changement d'étape, sans annoncer chaque frame
  ni chaque variation de progression.

### 8.5 Architecture générale

```text
Navigateur
├── Sélection batch et progression
├── Sélection des documents
├── Chat et historique de session
└── Réponse streamée et sources
          │
          ▼
Application Next.js sur Vercel
├── Route Handlers REST
├── Validation et sécurité
├── Orchestration des uploads
├── Parsers de documents
├── Chunking et embeddings
├── Retrieval et construction du prompt
└── Streaming LLM
          │
          ├── Vercel Blob : fichiers originaux
          ├── MongoDB Atlas : batches, documents, chunks et vecteurs
          ├── Gemini : embeddings et génération
          └── Upstash Redis : rate limiting uniquement
```

Il s'agit d'un monolithe modulaire : un repository et un déploiement, avec des
frontières claires entre composants frontend, routes HTTP et services serveur.

## 9. Décisions techniques

| Besoin | Décision | Justification |
| --- | --- | --- |
| Framework | Next.js App Router | Frontend et API serverless dans une application conforme au sujet. |
| Langage | TypeScript strict | Exigence obligatoire et contrats partagés fiables. |
| Interface | React et Tailwind CSS | Construction locale d'une interface sobre, responsive et accessible. |
| Icônes | Lucide React | SVG cohérents et légers, sans illustrations générées par IA. |
| Mouvement | CSS, transitions React et SVG écrits manuellement | Animations propres à chaque opération sans dépendance supplémentaire. |
| Fichiers | Vercel Blob privé | Upload direct adapté aux limites de payload des fonctions Vercel. |
| PDF natif | `pdf-parse` 2.4.5 | Extraction page par page compatible Node/Vercel, sans OCR ni framework RAG. |
| Persistance | MongoDB Atlas | Une base pour données métier, chunks, vecteurs, filtres et recherche hybride. |
| Accès MongoDB | Driver officiel `mongodb` | Pas d'ORM nécessaire pour trois collections simples. |
| Runtime | Node.js 22 minimum, Node.js 24 sur Vercel | Compatible avec Next.js 16 et AI SDK 7 tout en préparant les déploiements Vercel actuels. |
| Embeddings | `gemini-embedding-2`, dimension 768 | Limite d'entrée 8 192 tokens ; les vecteurs 768 sont recommandés et normalisés automatiquement. |
| Génération | `gemini-3.7-flash` | Modèle stable avec 1 048 576 tokens d'entrée, 65 536 tokens de sortie et niveau de raisonnement `medium`. |
| Streaming | AI SDK 7, `@ai-sdk/google` et `@ai-sdk/react` | Flux UI typé, annulation et custom data parts pour les sources documentaires. |
| Rate limiting | Upstash Redis | Compteur distribué compatible serverless, ajouté au moment du hardening. |
| Framework RAG | Pipeline TypeScript direct | Le périmètre est petit et doit rester visible, testable et explicable. |
| Queue | Aucune initialement | Le traitement synchrone est mesuré avant d'ajouter une infrastructure. |
| Coût des services | Offres gratuites uniquement | Aucun composant obligatoire ne dépend d'un plan payant ; si une capacité n'existe pas dans le free tier retenu, l'implémentation doit utiliser une alternative gratuite. |

## 10. Modèle de données minimal

### 10.1 `batches`

```ts
type Batch = {
  id: string;
  sessionId: string;
  status: "processing" | "ready" | "partial" | "failed";
  totalFiles: number;
  readyFiles: number;
  failedFiles: number;
  createdAt: Date;
  expiresAt: Date;
};
```

### 10.2 `documents`

```ts
type Document = {
  id: string;
  clientId: string;
  batchId: string;
  sessionId: string;
  filename: string;
  fileType: "pdf" | "docx" | "pptx" | "xlsx" | "txt" | "md" | "csv";
  blobPathname: string;
  blobUrl?: string;
  size: number;
  status:
    | "queued"
    | "uploading"
    | "validating"
    | "extracting"
    | "chunking"
    | "embedding"
    | "indexing"
    | "ready"
    | "failed";
  error?: { code: string; message: string };
  createdAt: Date;
  expiresAt: Date;
};
```

### 10.3 `chunks`

```ts
type Chunk = {
  id: string;
  sessionId: string;
  batchId: string;
  documentId: string;
  filename: string;
  fileType: Document["fileType"];
  text: string;
  embedding: number[];
  source: {
    label: string;
    page?: number;
    slide?: number;
    section?: string;
    sheet?: string;
    cellRange?: string;
    lineStart?: number;
    lineEnd?: number;
  };
  chunkIndex: number;
  createdAt: Date;
  expiresAt: Date;
};
```

Index prévus :

- Index Vector Search sur `chunks.embedding` avec filtres `batchId` et `documentId`.
- Index Search full-text sur `chunks.text`.
- Index classiques sur les identifiants et les statuts.
- Index TTL sur `expiresAt` pour supprimer les données de démonstration.

## 11. Contrat de normalisation des parsers

Chaque parser reçoit un fichier vérifié et produit la même structure :

```ts
type DocumentBlock = {
  text: string;
  source: {
    label: string;
    page?: number;
    slide?: number;
    section?: string;
    sheet?: string;
    cellRange?: string;
    lineStart?: number;
    lineEnd?: number;
  };
};

interface DocumentParser {
  supports(fileType: Document["fileType"]): boolean;
  extract(content: ArrayBuffer): Promise<DocumentBlock[]>;
}
```

Références par format :

| Format | Unité et source |
| --- | --- |
| PDF | Texte page par page, source `Page N`. |
| DOCX | Titres, paragraphes et tableaux, source par section. |
| PPTX | Titre, texte et tableaux, source `Slide N - Titre`. |
| XLSX | Lignes avec en-têtes, source `Feuille - A1:F20`. |
| TXT | Blocs de lignes, source `Lignes N-M`. |
| Markdown | Sections sous chaque titre. |
| CSV | Lignes avec en-têtes, source `Lignes N-M`. |

## 12. API prévue

| Méthode et route | Responsabilité |
| --- | --- |
| `POST /api/batches` | Valider le manifeste et créer le batch et ses documents. |
| `POST /api/batches/:batchId/documents` | Ajouter de nouveaux documents au batch courant après contrôle des limites cumulées. |
| `POST /api/upload` | Autoriser l'upload Blob et traiter la fin d'upload. |
| `GET /api/batches/:batchId` | Retourner la progression et les erreurs du batch. |
| `POST /api/documents/:documentId/retry` | Relancer un document en erreur. |
| `POST /api/documents/:documentId/replace` | Valider un nouveau fichier, conserver le document et le préparer pour le flux d'upload existant. |
| `DELETE /api/documents/:documentId` | Supprimer le fichier, les métadonnées et les chunks. |
| `POST /api/chat` | Valider, retrouver le contexte et streamer la réponse. |
| `GET /api/health` | Vérifier que l'application et ses dépendances répondent. |

Contrat initial de `POST /api/chat` :

- Le body JSON est limité à 1 MiB et contient `batchId`, de 1 à 10
  `documentIds` uniques, la nouvelle `message` et l'`history` textuelle.
- L'historique accepté ne contient que des messages `user` et `assistant` non
  vides. Les sources affichées dans l'UI ne sont jamais renvoyées comme contexte
  de confiance au modèle.
- La session, la propriété du batch et des documents, ainsi que l'état `ready`
  de chaque document conservé sont vérifiés avant l'ouverture du stream.
- Les erreurs de validation, de session, d'état ou de retrieval restent des
  réponses JSON structurées. Une erreur de génération survenant après le début
  du stream devient une erreur SSE générique sans détail sensible.

Format d'erreur commun :

```ts
type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
};
```

## 13. Pipeline d'ingestion

```text
Sélection unique de plusieurs fichiers
        ↓
Validation client du batch
        ↓
Création du batch et des documentId
        ↓
Uploads Blob directs avec concurrence limitée
        ↓
Validation serveur : type, signature, taille et limites métier
        ↓
Parser adapté au format
        ↓
DocumentBlock[] normalisés et sourcés
        ↓
Chunking tenant compte des limites de source
        ↓
Embeddings générés par lots
        ↓
Écriture des chunks et vecteurs dans MongoDB Atlas
        ↓
Vérification que le document est interrogeable
        ↓
Document marqué ready ou failed
```

Paramètres initiaux à évaluer :

- Environ 600 tokens par chunk, estimés simplement à 450 mots.
- Environ 100 tokens d'overlap, estimés à 75 mots.
- Aucun chunk ne mélange deux documents.
- Les limites de page, slide, section ou feuille restent traçables.
- Les embeddings sont envoyés par lots contrôlés.

Ces valeurs sont des hypothèses de départ et peuvent changer uniquement après
les tests d'évaluation.

## 14. Pipeline de chat

```text
Question + documentId sélectionnés
        ↓
Validation et rate limiting
        ↓
Embedding de la question
        ↓
Filtre MongoDB sur sessionId et documentId
        ↓
Recherche vectorielle et full-text en parallèle
        ↓
Fusion RRF déterministe côté application
        ↓
Déduplication et sélection du contexte
        ↓
Prompt avec règle de refus et contexte balisé comme données
        ↓
Génération Gemini en streaming
        ↓
Réponse progressive + sources
```

Paramètres initiaux :

- Aucun nombre fixe de chunks dans le contexte final.
- Le retrieval récupère les candidats pertinents, les déduplique et les ajoute
  tant qu'ils restent sous le budget d'entrée disponible du modèle.
- La recherche Atlas reçoit une limite de candidats calculée par le chat selon
  ce budget, plafonnée à 500 résultats. Ce plafond concerne la recherche, pas
  un nombre imposé de chunks dans le contexte final.
- La recherche ANN examine initialement 20 fois plus de voisins que de
  résultats demandés, avec un maximum Atlas de 10 000 candidats. Ces valeurs
  ne changent qu'après mesure du rappel et de la latence.
- La fusion hybride utilise RRF côté application avec la constante standard 60.
  Ce choix combine deux pipelines Atlas simples, reste testable et ne dépend
  pas de l'étage serveur `$rankFusion` ni d'une version MongoDB imposée. Le
  score affiché est nommé `Hybrid score`, distinct de la similarité
  cosinus affichée lors d'une recherche vectorielle seule.
- Le budget documentaire vaut la limite d'entrée de 1 048 576 tokens moins les
  instructions, l'historique, la question et une marge de sécurité de 16 384
  tokens.
- La limite de sortie configurée est 65 536 tokens ; il s'agit d'un plafond et
  non d'une longueur de réponse imposée.
- Seuil de pertinence déterminé par l'évaluation.
- Aucune connaissance générale ne complète une information absente.
- Aucun outil Google Search ou accès web n'est activé pour le modèle.
- Les sources MongoDB sont envoyées au début du stream comme custom data part
  persistante `data-sources`, puis le texte du modèle est fusionné dans le même
  UI message stream.
- Les custom data parts de sources restent dans l'historique UI mais ne sont pas
  reconverties en contexte modèle. Le serveur reconstruit explicitement le
  contexte RAG autorisé à chaque question.
- L'historique navigateur est séparé par batch et par combinaison de documents
  sélectionnés. Changer la sélection démarre donc un contexte de chat distinct
  et ne réinjecte pas les réponses obtenues depuis un document ensuite exclu.

## 15. Sécurité

- Secrets uniquement dans les variables serveur Vercel.
- Validation client et nouvelle validation côté serveur.
- Liste blanche stricte des extensions et MIME types.
- Lecture incrémentale et bornée des corps de requête ; une taille déclarée ou
  réellement lue au-dessus de la limite est interrompue avec une erreur `413`.
- Vérification de la signature `%PDF-` avant le parsing d'un PDF.
- Inspection des archives OOXML : nombre d'entrées, taille décompressée et rejet
  des fichiers avec macros afin de limiter les ZIP bombs, à réaliser avec
  `FMT-06` avant d'activer les formats Office.
- Nom de fichier normalisé en Unicode NFC ; séparateurs de chemin, contrôles,
  contrôles bidirectionnels et noms de plus de 255 caractères refusés.
- Vérification du `sessionId` sur chaque lecture, suppression et recherche.
- Filtres MongoDB sur les documents explicitement sélectionnés.
- Contenu documentaire traité comme donnée non fiable dans le prompt.
- Réponses affichées en texte React sans interprétation de HTML brut.
- Headers globaux `nosniff`, `no-referrer`, anti-framing et désactivation des
  capteurs inutilisés. Une CSP sera définie avec le déploiement réel afin de ne
  pas inventer les origines Blob/Vercel avant `SET-07`.
- Aucun log de production ne contient de document, vecteur, question, réponse,
  secret, IP brute ou identifiant de session. Chaque route API écrit sur
  `stdout` une ligne JSON limitée à : horodatage, niveau, événement,
  `requestId`, méthode, route générique, opération, statut, durée et code
  d'erreur. Ces lignes apparaissent dans le terminal local et dans les Runtime
  Logs Vercel après déploiement.
- Le rate limiting partagé Upstash utilise trois compteurs par adresse client
  anonymisée par HMAC : upload/remplacement `30/min`, retry `5/min` et chat
  `10/min`. La création du batch, les autorisations et échecs d'upload navigateur
  sont comptés ; le callback Blob signé ne l'est pas.
- Les réponses bloquées utilisent `429`, `Retry-After` et les en-têtes
  `X-RateLimit-*`. Analytics Upstash est désactivé, un cache éphémère évite des
  appels Redis répétés pour une adresse déjà bloquée et le timeout est de 1 s
  avec le comportement fail-open du SDK.
- Suppression automatique par TTL et suppression manuelle cohérente.

## 16. Performance et comportement serverless

- Upload direct vers Blob pour ne pas traverser la limite de payload Vercel.
- Deux traitements simultanés au départ.
- Embeddings par lots plutôt qu'un appel par chunk.
- Instance MongoClient réutilisée entre invocations chaudes.
- Index sur tous les champs de filtre utilisés par le retrieval.
- Streaming du chat sans attendre la réponse complète.
- `AbortSignal` propagé lorsque le client annule une requête.
- Timeout explicite pour les appels externes.
- Mesure de la durée par étape avant toute optimisation.
- Queue ou traitement différé ajouté seulement si les mesures Vercel l'exigent.

## 17. Stratégie de tests

### Tests unitaires

- Validation de batch et de fichiers.
- Normalisation de chaque parser avec une fixture minimale.
- Chunking, overlap et conservation des sources.
- Construction du prompt et règle de refus.
- Fusion ou déduplication des résultats.
- Mapping des erreurs externes vers `ApiError`.

### Tests d'intégration

- Création d'un batch et transitions de statut.
- Ingestion d'un fichier avec Gemini et MongoDB simulés.
- Retrieval filtré par `documentId`.
- Suppression cohérente d'un document.
- Endpoint de chat avec flux LLM simulé.
- Parcours bonus déterministe à deux PDF : manifeste frontend, création du batch,
  sélection des deux documents, recherches vectorielle et lexicale fusionnées
  par RRF, sources multi-documents, logs JSON sûrs puis réponse `429` avant une
  nouvelle recherche. Ce test local ne remplace pas le parcours externe de
  `GATE-02`.

### Test end-to-end principal

```text
Sélection de plusieurs fichiers
→ lancement unique du batch
→ progression jusqu'à ready
→ question
→ réponse streamée
→ sources visibles
```

### Évaluation RAG

- Cinq questions avec réponses et sources attendues.
- Au moins une question dont la réponse est absente.
- Mesure de présence de la bonne source dans le top-K.
- Vérification de la citation finale.
- Cas français et arabe inclus.

## 18. Plan de réalisation détaillé sur une journée

La journée suppose que les comptes, clés et fixtures sont prêts avant le début.
Les horaires sont des timeboxes, pas une permission de livrer une étape cassée.

| Horaire | Agent principal | Agents IA parallèles | Résultat attendu |
| --- | --- | --- | --- |
| 08:30-09:00 | Vérifier les secrets, créer les index Atlas et confirmer le build. | Agent QA vérifie le périmètre et les fixtures. | Environnement externe prêt. |
| 09:00-10:00 | Intégrer les contrats batch et contrôler les fichiers partagés. | Agent frontend construit le sélecteur batch et ses tests. | Étape 1 validée et commitée. |
| 10:00-11:15 | Implémenter MongoDB, création du batch et orchestration Blob. | Agent QA prépare les tests API ; agent parsers prépare le contrat commun. | Upload batch sécurisé opérationnel. |
| 11:15-12:30 | Intégrer PDF, chunking, embeddings et stockage Atlas. | Agent parsers réalise PDF/TXT/Markdown ; agent QA teste chunking et statuts. | Premier document indexé de bout en bout. |
| 12:30-13:30 | Implémenter retrieval, prompt et `POST /api/chat`. | Agent frontend construit le chat streamé ; agent QA prépare les mocks LLM. | Première réponse streamée et sourcée. |
| 13:30-15:00 | Intégrer et revoir les parsers sans modifier leur contrat. | Agent parsers réalise DOCX/PPTX ; autre agent réalise CSV/XLSX et fixtures. | Tous les formats produisent des blocs normalisés. |
| 15:00-16:00 | Finaliser sélection multi-documents et suppression. | Agent frontend finalise progression, retry et sources. | Parcours utilisateur complet. |
| 16:00-17:00 | Ajouter recherche hybride, rate limiting et logs. | Agent QA ajoute les tests sécurité et erreurs. | Bonus backend validés. |
| 17:00-18:00 | Exécuter l'évaluation et corriger les défauts mesurés. | Agents relisent retrieval, arabe/français et accessibilité. | Résultats d'évaluation enregistrés. |
| 18:00-19:00 | Build final, déploiement Vercel et smoke tests. | Agent documentation complète README et checklist, sans commit. | URL publique, README et livrables prêts. |

**Quality gate à 13:30 :** le parcours PDF P0 doit être déployable et testé de
bout en bout, y compris le streaming, les sources et le refus. Si ce gate
échoue, les parsers P2 sont temporairement suspendus jusqu'au rétablissement de
P0. Les formats P2 sont ensuite intégrés dans l'ordre TXT/Markdown/CSV, DOCX,
PPTX puis XLSX.

### Règles de collaboration des agents IA

- L'agent principal possède l'architecture, les dépendances, les routes, Git et
  la décision finale.
- Chaque agent reçoit une tâche bornée et un ensemble de fichiers sans conflit.
- Les agents ne modifient pas simultanément `package.json`, le lockfile, les
  contrats communs ou les mêmes routes.
- Les agents ne créent pas de commit ; l'agent principal relit, intègre, teste
  et commit.
- Toute proposition qui élargit le périmètre est refusée ou ajoutée d'abord à
  ce document après validation.
- Un résultat d'agent n'est intégré qu'après lecture du diff et exécution des
  tests correspondants.

## 19. Backlog d'exécution fermé

Cette section est la liste exhaustive des tâches autorisées pour la journée.
Une fonctionnalité qui n'a pas d'identifiant dans ce backlog ne doit pas être
implémentée. Si une nouvelle nécessité apparaît, l'agent principal arrête la
tâche concernée, documente le besoin et fait valider la modification de ce
document avant de reprendre.

### 19.1 Statuts utilisés

- `[ ]` : tâche non commencée.
- `[~]` : tâche en cours, attribuée à un seul responsable.
- `[x]` : tâche terminée avec preuves vérifiées par l'agent principal.
- `[!]` : tâche bloquée avec cause et prochaine action documentées.

Une tâche n'est jamais marquée terminée sur la seule déclaration d'un agent.
Elle doit satisfaire sa condition de fin, fournir les résultats des commandes
de vérification et passer la revue du diff.

### 19.2 Ordre des sources et protocole anti-hallucination

En cas de contradiction, l'ordre d'autorité est :

1. Le cahier des charges fourni par Smartly.ai.
2. Le présent document de référence validé par le propriétaire du projet.
3. La fiche de tâche numérotée attribuée à l'agent.
4. Le code et les tests déjà intégrés.
5. Les suppositions ou recommandations d'un agent.

Règles obligatoires pour tous les agents :

- Lire l'objectif, les dépendances et la condition de fin de la tâche avant de
  modifier un fichier.
- Ne travailler que sur la tâche attribuée et les fichiers autorisés.
- Ne jamais inventer un endpoint, un état, une limite, une dépendance, un modèle
  ou une fonctionnalité absente de cette référence.
- Lire `AGENTS.md` et la documentation Next.js locale ciblée avant tout code
  Next.js ; pour Gemini, Atlas, Blob et Upstash, vérifier l'API actuelle dans
  leur documentation officielle au moment de l'intégration.
- Ne jamais prétendre qu'un service externe fonctionne si seule une simulation
  ou un mock a été testé. Les mocks sont acceptés uniquement dans les tests.
- Ne pas contourner une clé, un compte, un index ou une décision manquante :
  signaler le blocage avec l'erreur exacte.
- Ne pas corriger, refactorer ou reformater des fichiers sans rapport avec la
  tâche.
- Proposer séparément toute amélioration hors périmètre, sans l'implémenter.
- Retourner à l'agent principal : hypothèses, fichiers modifiés, tests exécutés,
  résultats, limites restantes et risques.

### 19.3 Propriété des zones de fichiers

| Zone | Propriétaire pendant la tâche | Règle |
| --- | --- | --- |
| `package.json`, `pnpm-lock.yaml`, configuration et variables | Agent principal | Aucun autre agent ne modifie les dépendances ou la configuration. |
| `src/types/` et contrats partagés | Agent principal | Contrats verrouillés avant les travaux parallèles. |
| `src/components/`, styles et tests UI associés | Agent UI | Ne modifie ni routes API ni services serveur. |
| `src/lib/documents/` et fixtures de parser | Agent ingestion | Respecte le contrat `DocumentParser`. |
| `src/lib/db/`, `src/lib/rag/`, `src/app/api/` | Agent backend/RAG | Ne change pas les contrats sans accord de l'agent principal. |
| Tests transversaux, évaluation et documentation | Agent QA/documentation | N'édite pas le code métier pour faire passer un test. |

Une zone ne peut avoir qu'un agent actif à la fois. Les fichiers partagés sont
intégrés par l'agent principal avant le lancement d'une nouvelle vague.

### 19.4 Tâches de préparation

| État | ID | Priorité | Dépend de | Responsable | Tâche et condition de fin |
| --- | --- | --- | --- | --- | --- |
| [x] | SET-00 | P0 | - | Principal | Relire, valider puis committer le présent cadrage. Le diff ne contient que la documentation attendue. |
| [x] | SET-01 | P0 | SET-00 | Principal | Lire les sections locales Next.js 16 nécessaires : App Router, Route Handlers, cookies, variables serveur, upload et streaming. Les contraintes retenues sont notées avant le code. |
| [x] | SET-02 | P0 | SET-00 | Principal | Confirmer dans les documentations officielles les SDK, modèles, dimensions, runtimes et limites de Vercel, Blob, Atlas, Gemini et Upstash. Les décisions exactes sont inscrites en 20.3. |
| [x] | SET-03 | P0 | SET-01, SET-02 | Principal | Installer uniquement les dépendances directement requises et enregistrer un lockfile cohérent. `pnpm check` et `pnpm build` réussissent. |
| [x] | SET-04 | P0 | SET-01 | Principal | Créer les contrats TypeScript partagés : fichier, batch, statuts, source, parser et erreur API. Les statuts et transitions impossibles sont testés. |
| [x] | SET-05 | P0 | SET-00 | QA | Préparer les fixtures libres de droits et le manifeste d'évaluation : petit PDF français, PDF arabe natif et fichiers invalides. La licence ou l'origine est documentée. |
| [x] | SET-07 | P0 | SET-02 | Principal | GitHub, le projet Vercel, Blob privé, Upstash, Gemini et Atlas sont configurés et vérifiés réellement. Les secrets restent hors Git et les variables serveur sont présentes dans Production, Preview et Development. |
| [~] | SET-06 | P0 | SET-03, SET-07 | Principal | Le projet Vercel est créé et connecté au repository GitHub. Le premier déploiement public et son smoke test restent à exécuter après validation de l'intégration Blob standard. |

### 19.5 Tâches P0 - parcours PDF obligatoire

| État | ID | Dépend de | Responsable | Tâche et condition de fin |
| --- | --- | --- | --- | --- |
| [x] | UI-01 | SET-04 | UI | Construire le shell responsive : toutes les actions d'upload dans le panneau Documents, visualisation du pipeline dans la surface centrale, zone de chat et composer désactivé. Tests de rendu et navigation clavier réussis. |
| [x] | API-01 | SET-03, SET-04 | Backend | Créer la session anonyme par cookie HTTP-only signé et appliquer `sessionId` à toutes les opérations. Un accès croisé est refusé par test. |
| [x] | UPL-01 | SET-04, UI-01 | UI | Implémenter sélection multiple, drag-and-drop et vérification locale du nombre, type et poids. Les erreurs sont affichées fichier par fichier avant l'envoi. |
| [x] | UPL-02 | API-01 | Backend | Implémenter `POST /api/batches` avec manifeste validé, limites serveur, identifiants et statuts initiaux. Les erreurs suivent `ApiError`. |
| [~] | UPL-03 | UPL-02, SET-02 | Backend | `POST /api/upload` utilise le flux client officiel `BLOB_READ_WRITE_TOKEN`, sans faire transiter le fichier par la fonction. Un PDF réel a été envoyé dans le store privé, refusé sans authentification (`403`), téléchargé avec un hash identique puis supprimé. Le callback applicatif reste à valider sur l'URL déployée. |
| [x] | DB-01 | SET-02, SET-04 | Backend | Créer l'accès MongoDB, les repositories minimaux et les définitions d'index classiques, TTL et Vector Search. Connexion réutilisée et filtres de session testés. |
| [x] | PAR-01 | SET-04, SET-05 | Ingestion | Extraire un PDF natif page par page vers `DocumentBlock[]`, avec numéro de page et erreurs explicites pour PDF vide, chiffré ou non extractible. |
| [x] | RAG-01 | PAR-01 | Ingestion | Implémenter le chunking sourcé avec paramètres configurables, sans mélange de documents ni perte de page. Tests de taille, overlap et source réussis. |
| [x] | RAG-02 | SET-02, RAG-01 | Backend/RAG | Code, batching AI SDK, concurrence 2, timeout et validation 768 terminés. Les appels réels `gemini-embedding-2` avec `RETRIEVAL_QUERY` et `RETRIEVAL_DOCUMENT` ont produit 768 valeurs finies. |
| [~] | ING-01 | UPL-03, DB-01, RAG-02 | Principal | Orchestrer `uploading → validating → extracting → chunking → embedding → indexing → ready/failed`. Pipeline PDF, Gemini, Atlas et stockage Blob sont prêts ; l'essai complet attend le callback réel de l'application déployée. |
| [x] | UPL-04 | ING-01 | Backend | Implémenter `GET /api/batches/:batchId` avec les états et erreurs de chaque fichier, filtrés par session. Le contrat est testé avant son utilisation par l'UI. |
| [x] | UI-02 | UPL-04 | UI | Afficher la progression par polling borné, une ligne stable par fichier et le libellé réel de chaque opération. Aucun faux pourcentage n'est affiché. |
| [x] | UI-03 | UI-02 | UI | Animations CSS/SVG manuelles terminées pour sélection, validation, upload réel, extraction, chunking, embeddings, indexation, succès, échec, retry, remplacement et suppression. `prefers-reduced-motion` et les annonces `aria-live` sont couverts par les tests. |
| [~] | API-02 | ING-01 | Backend | Statut du batch, retry idempotent, ajout de documents au batch courant et suppression terminés et testés localement. L'ajout contrôle les limites cumulées de 10 fichiers et 50 MiB ; la suppression nettoie le Blob, les métadonnées et les chunks. Le parcours réel attend le smoke test déployé. |
| [~] | UI-04 | API-02, UI-03 | UI | `Réessayer`, `Supprimer` et `Add documents` sont reliés aux routes réelles. Le bouton initial `Upload` reste sous la liste ; après création du contexte, tout ajout valide est envoyé automatiquement sans second clic. Aucun contrôle ne remplace toute la sélection. Le gate du composer reste relié à l'état `ready` de tous les documents. |
| [x] | RAG-03 | DB-01, RAG-02 | Backend/RAG | Recherche vectorielle cosinus, embedding de question, filtres `sessionId`/batch/documents, déduplication et validation défensive terminés. Une fixture temporaire a été indexée, retrouvée par Vector Search avec les trois filtres exacts puis supprimée. |
| [~] | CHAT-01 | RAG-03 | Backend/RAG | `POST /api/chat`, validations avant stream, contexte dynamique, prompt fondé uniquement sur les documents, refus sans contexte et UI message stream sourcé sont implémentés et testés localement. Une génération réelle `gemini-3.7-flash` a réussi ; le seuil et le parcours complet attendent Atlas. |
| [~] | UI-05 | UI-04, CHAT-01 | UI | Chat relié à `/api/chat` avec `useChat`, historique `sessionStorage` isolé par batch, annulation et affichage progressif. Le composer ne s'active que lorsque tous les documents sont `ready` ; le parcours réel attend le smoke test Vercel. |
| [~] | UI-06 | UI-05 | UI | Sources dépliables affichées sous chaque réponse avec numéro de citation, fichier, emplacement, extrait et score : `Similarity` pour le cosinus seul ou `Hybrid score` pour RRF. Le contrôle natif est utilisable au clavier et responsive ; le flux réel Atlas/Gemini reste à valider dans `GATE-01`. |
| [x] | UI-07 | UI-05 | UI | Avant le premier message, la surface centrale présente le pipeline complet avec six scènes SVG/CSS personnalisées : vue explicative avant upload, état actif pendant traitement et replay lorsque le contexte est prêt. La séquence couvre les thèmes clair/sombre et `prefers-reduced-motion`, puis disparaît dès le premier message. |
| [x] | SEC-01 | UPL-03, CHAT-01 | Backend/QA | Extension, MIME, signature PDF, limites de fichiers et requêtes, noms, sessions, propriété des ressources, prompt injection, rendu HTML inerte, headers et absence de logs sensibles sont vérifiés localement avec cas négatifs. |
| [x] | TST-01 | SEC-01, UI-06 | QA | Les tests unitaires et d'intégration P0 couvrent contrats, upload, parser, chunker, statuts, retrieval, refus, streaming, sources, sécurité et erreurs. `lint`, `typecheck`, tests et build réussissent localement. |
| [~] | GATE-01 | TST-01 | Principal | Le code et le parcours déterministe sont verts ; Gemini, Upstash, Atlas et Blob sont joignables. Le parcours PDF applicatif complet — callback, ingestion, streaming, source, refus, retry et suppression — doit maintenant être validé sur l'URL Vercel ; aucune simulation n'est présentée comme un E2E réel. |

### 19.6 Tâches P1 - bonus retenus

| État | ID | Dépend de | Responsable | Tâche et condition de fin |
| --- | --- | --- | --- | --- |
| [~] | BON-01 | GATE-01 | Principal/UI | Multi-PDF, réussite indépendante, sélection de tous les documents par défaut et exclusion contrôlée sont implémentés. Les tests prouvent que le backend applique les identifiants choisis ; le batch réel reste à valider dans `GATE-01`. |
| [x] | BON-02 | GATE-01 | Backend/RAG | Les index réels `chunk_vector_search` et `chunk_text_search` sont `READY`. Une fixture temporaire a été retrouvée par les deux recherches avec les filtres exacts puis supprimée ; la fusion RRF côté application est couverte par les tests déterministes. |
| [~] | BON-03 | GATE-01, SET-02 | Backend | Rate limiting partagé Upstash implémenté et testé localement sur upload/remplacement `30/min`, retry `5/min` et chat `10/min`, avec réponses `429` structurées. La connexion réelle Upstash en lecture/écriture est validée et le callback Blob authentifié est exempté ; le parcours d'API déployé attend `GATE-02`. |
| [x] | BON-04 | GATE-01 | Backend/QA | Chaque route API produit une ligne JSON avec `requestId`, durée, opération et code d'erreur sur `stdout`, sans contenu documentaire, question, réponse, vecteur, secret, IP brute ni session. Les cas succès, rejet et exception sont testés. |
| [ ] | BON-05 | GATE-01, SET-05 | QA | Vérifier le parcours complet sur PDF français et arabe, affichage RTL du contenu arabe compris. Les résultats et défauts sont enregistrés. |
| [ ] | BON-06 | BON-02, BON-05 | QA/RAG | Exécuter les cinq questions d'évaluation, dont une absente, et mesurer présence de la source dans le top-K, refus et citation. Ajuster seulement sur preuve. |
| [x] | BON-07 | BON-01, BON-03, BON-04 | QA | Un test intégré déterministe couvre le contrat frontend, la création d'un batch de deux PDF, le chat sur les deux documents, la fusion hybride RRF, les sources, les logs sans données sensibles et le blocage `429` avant toute recherche supplémentaire. Le parcours externe réel reste réservé à `GATE-02`. |
| [ ] | GATE-02 | BON-06, BON-07 | Principal | Rejouer P0 et P1 sur le déploiement. Les bonus sont conservés seulement s'ils ne régressent pas le cœur PDF. |

### 19.7 Tâches P2 - formats supplémentaires

Les formats sont intégrés dans l'ordre ci-dessous. Une tâche ne démarre que si
`GATE-01` est validé ; un problème sur P2 ne doit pas déclencher une réécriture
du pipeline P0.

| État | ID | Dépend de | Responsable | Tâche et condition de fin |
| --- | --- | --- | --- | --- |
| [ ] | FMT-00 | GATE-01 | Principal/Ingestion | Finaliser le registre de parsers autour de `DocumentParser`, sans framework RAG ni abstraction supplémentaire. Un format inconnu est refusé proprement. |
| [ ] | FMT-01 | FMT-00 | Ingestion | Ajouter TXT et Markdown en conservant lignes, titres et sections dans les sources. Fixtures et tests passent. |
| [ ] | FMT-02 | FMT-01 | Ingestion | Ajouter CSV avec en-têtes, plages de lignes, encodage contrôlé et limite de taille extraite. Fixtures et tests passent. |
| [ ] | FMT-03 | FMT-02 | Ingestion | Ajouter DOCX : titres, paragraphes et tableaux, sans macros ni contenu actif. Fixtures et tests passent. |
| [ ] | FMT-04 | FMT-03 | Ingestion | Ajouter PPTX : numéro, titre, texte et tableaux par slide. Fixtures et tests passent. |
| [ ] | FMT-05 | FMT-04 | Ingestion | Ajouter XLSX : feuilles, en-têtes, cellules non vides et plages sources, avec limite de 50 000 cellules. Fixtures et tests passent. |
| [ ] | FMT-06 | FMT-03, FMT-04, FMT-05 | Backend/QA | Vérifier signatures ZIP OOXML, nombre d'entrées, taille décompressée, fichiers chiffrés et formats macro-enabled. Les ZIP bombs sont refusées. |
| [ ] | UI-07 | FMT-06 | UI | Afficher correctement les formats, statuts et labels de source page/section/slide/feuille/lignes sans modifier le parcours principal. |
| [ ] | TST-02 | UI-07 | QA | Exécuter ingestion et question sourcée sur une fixture de chaque format, plus les erreurs partielles d'un batch mixte. |
| [ ] | GATE-03 | TST-02 | Principal | Rejouer le parcours multi-format complet sans régression de P0/P1. Chaque format conservé possède une preuve d'extraction et de retrieval. |

### 19.8 Tâches de finition et livraison

| État | ID | Dépend de | Responsable | Tâche et condition de fin |
| --- | --- | --- | --- | --- |
| [ ] | FIN-01 | GATE-02, GATE-03 | UI/QA | Vérifier responsive 320 px/desktop, clavier, focus, contrastes, lecteur d'écran et réduction de mouvement sur tout le parcours. |
| [ ] | FIN-02 | GATE-02 | Principal/Backend | Vérifier timeouts, annulation, concurrence 2, limites de payload et durées par étape. Optimiser uniquement un défaut mesuré. |
| [ ] | FIN-03 | GATE-02 | Documentation | Compléter README : architecture, API, variables, index Atlas, limites, sécurité, choix de persistance, absence de LangChain, tests et évaluation. |
| [ ] | FIN-04 | FIN-01, FIN-02, FIN-03 | Principal | Exécuter `pnpm lint`, `pnpm typecheck`, `pnpm test` et `pnpm build` dans un checkout propre. Toutes les commandes réussissent. |
| [ ] | FIN-05 | FIN-04 | Principal | Configurer la production Vercel, Atlas, Blob, Gemini et Upstash avec secrets serveur et régions confirmées. Aucun secret n'entre dans Git. |
| [ ] | FIN-06 | FIN-05 | Principal/QA | Faire un smoke test de l'URL publique dans une session neuve : PDF, batch, erreur, retry/remove, streaming, sources, refus, FR et arabe. |
| [ ] | FIN-07 | FIN-06 | Principal | Relire le diff final, retirer uniquement les traces de debug, vérifier l'historique atomique et remettre le repository propre. La Definition of Done est cochée preuve par preuve. |

### 19.9 Traçabilité du cahier des charges

| Exigence | Tâches qui la prouvent |
| --- | --- |
| F1 - Upload PDF | UPL-01, UPL-02, UPL-03, PAR-01, ING-01, UI-02 |
| F2 - Pipeline RAG | RAG-01, RAG-02, DB-01, ING-01, RAG-03 |
| F3 - Chat Q&A | CHAT-01, UI-05, GATE-01 |
| F4 - Sources | RAG-03, UI-06 |
| F5 - API REST | API-01, UPL-02, UPL-03, API-02, CHAT-01 |
| F6 - Streaming | CHAT-01, UI-05, GATE-01 |
| Bonus | BON-01 à BON-07 et GATE-02 |
| Multi-formats décidé | FMT-00 à FMT-06, UI-07, TST-02 et GATE-03 |

### 19.10 Format obligatoire d'une mission donnée à un agent

```text
ID de tâche :
Objectif exact :
Dépendances déjà validées :
Fichiers autorisés :
Fichiers interdits ou partagés :
Critères d'acceptation :
Tests à exécuter :
Éléments explicitement hors périmètre :
Format du compte rendu : hypothèses, diff, tests, résultats, limites, risques.
```

Une mission ne doit contenir qu'un objectif vérifiable. L'agent principal ne
lance pas deux missions qui modifient le même fichier et reste responsable de
l'intégration, des commandes finales et des commits.

### 19.11 Ordre des grandes phases et commits

| Étape | Livrable | Exemple de commit |
| --- | --- | --- |
| 0 | Fondation Next.js | `chore: initialize DocChat project` |
| 1 | Interface d'upload batch | `feat: add multi-file upload interface` |
| 2 | Upload Blob et persistance batch | `feat: add secure batch upload` |
| 3 | Extraction PDF normalisée | `feat: add PDF text extraction` |
| 4 | Chunking, embeddings et Atlas | `feat: add document ingestion pipeline` |
| 5 | Chat RAG streamé | `feat: add grounded streaming chat` |
| 6 | Sources et sélection multi-documents | `feat: add chat sources and document selection` |
| 7 | Parsers texte et Office | Un commit par famille de formats. |
| 8 | Recherche hybride | `feat: add hybrid document retrieval` |
| 9 | Rate limiting et logs | `feat: harden public API endpoints` |
| 10 | Évaluation et documentation | `docs: add RAG evaluation results` |
| 11 | Déploiement vérifié | `chore: prepare production deployment` |

À la fin de chaque grande phase :

```text
Implémentation ciblée
→ tests ciblés
→ pnpm check
→ pnpm build si nécessaire
→ vérification manuelle
→ revue du diff
→ commit atomique
→ résumé clair présenté au propriétaire du projet
```

## 20. Prérequis avant la journée de réalisation

- Compte et projet Vercel.
- Repository GitHub prêt à recevoir le projet.
- Cluster MongoDB Atlas créé.
- Index Search et Vector Search préparés.
- Clé Gemini disponible.
- Store Vercel Blob configuré.
- Base Upstash Redis disponible pour le rate limiting.
- Fixtures libres de droits pour tous les formats supportés.
- Au moins un PDF français et un PDF arabe à texte natif.

Variables attendues :

```text
MONGODB_URI
MONGODB_DATABASE
GOOGLE_GENERATIVE_AI_API_KEY
BLOB_READ_WRITE_TOKEN
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
APP_SECRET
```

### 20.1 Confirmations à faire avant l'implémentation concernée

- Confirmer que le compte Gemini expose `gemini-3.7-flash` et
  `gemini-embedding-2` avec les quotas nécessaires.
- Choisir des régions Vercel et MongoDB Atlas compatibles et proches.
- Valider les bibliothèques de parsing sur une fixture réelle de chaque format.
- Choisir et documenter les PDF d'évaluation français et arabe et leur licence.
- Calibrer `topK` et le seuil de refus avec le jeu d'évaluation, sans les fixer
  arbitrairement.
- Vérifier l'accès effectif à Vercel, Atlas, Blob, Gemini et Upstash.

### 20.2 Contraintes Next.js 16 confirmées localement

Ces règles proviennent de la documentation livrée avec Next.js 16.3.3 dans
`node_modules/next/dist/docs/` et sont obligatoires pour l'implémentation :

- Les endpoints utilisent uniquement les Route Handlers sous `src/app/api/` et
  les Web APIs `Request`, `Response` et `ReadableStream`.
- Les Route Handlers sont publics : chaque route valide ses entrées, la session,
  la propriété des ressources et les limites ; aucune sécurité implicite n'est
  supposée.
- Les paramètres des routes dynamiques sont des promesses. Ils sont attendus
  avec `await` ou typés avec le helper global `RouteContext` généré par Next.js.
- `cookies()` est asynchrone. La session est créée ou modifiée dans un Route
  Handler non streamé ; aucun cookie n'est écrit après le début du stream.
- Toute validation capable de produire une erreur HTTP est exécutée avant le
  premier chunk du chat, car statut et headers ne peuvent plus changer après le
  début du streaming.
- Les secrets restent dans des variables serveur sans préfixe `NEXT_PUBLIC_`.
  Les fichiers `.env*` sont placés à la racine, jamais sous `src/`, et ne sont
  pas commités.
- Les uploads utilisent le File API côté client et un stockage Blob dédié. Les
  fichiers et l'état ne sont jamais conservés sur le système de fichiers ou
  dans la mémoire partagée d'une fonction serverless.
- Le polling des statuts part du navigateur ; un Server Component ne fait pas
  un appel HTTP à ses propres Route Handlers.
- Les handlers de traitement utilisent le runtime Node.js lorsque les parsers
  ou le driver MongoDB le demandent. Le mode `export` statique est exclu.
- La frontière `'use client'` est placée uniquement à l'entrée des sous-arbres
  interactifs. Aucun module serveur, secret, parser ou accès base de données ne
  doit entrer dans le bundle client.
- Le body d'une requête n'est lu qu'une fois sauf clonage explicite. Les erreurs
  renvoyées au client ne contiennent aucun détail sensible.
- Vercel supporte le streaming, mais son fonctionnement réel est vérifié sur la
  réponse réseau déployée et pas uniquement sur l'affichage final du navigateur.
- L'exemple AI SDK inclus dans la documentation locale n'est pas copié sans
  vérifier les APIs actuelles de la version installée au moment de `SET-03`.

### 20.3 Choix externes confirmés dans les documentations officielles

Tous les services externes doivent être configurés sur leur offre gratuite.
Aucune carte, montée de plan ou capacité réservée à un plan payant n'est une
dépendance acceptable. Les quotas réels seront relevés pendant `SET-07` et les
limites de démonstration resteront en dessous de ces quotas.

- AI SDK : `ai@7.0.90`, `@ai-sdk/react@4.0.93` et
  `@ai-sdk/google@4.0.62`. Les anciens contrats `StreamingTextResponse`,
  `message.content` et `ai/react` sont interdits.
- Génération : `gemini-3.7-flash`, sans Google Search ni outil externe.
- Embeddings : `gemini-embedding-2` avec `outputDimensionality: 768` ; les
  documents et questions utilisent des préfixes de tâche cohérents.
- Atlas : index Vector Search cosine de 768 dimensions, avec champs de filtre
  `sessionId`, `batchId` et `documentId`. L'index Search lexical reste séparé
  pour le bonus hybride ; la fusion RRF est faite dans l'application pour ne pas
  dépendre de `$rankFusion` ou d'une version de cluster particulière.
- Blob : store privé `docchat-files` en région `cdg1` et upload client direct
  signé avec le flux officiel `BLOB_READ_WRITE_TOKEN`, limité à 10 Mo par
  fichier. Le callback de fin d'upload est authentifié et idempotent. L'offre
  Hobby observée inclut 1 Go de stockage, 10 000 opérations simples, 2 000
  opérations avancées et 10 Go de transfert par mois, sans dépassement payant.
- Upstash : Redis régional avec sliding windows indépendantes : upload et
  remplacement `30/min`, retry `5/min`, chat `10/min`. L'adresse transmise par
  Vercel est transformée en identifiant HMAC avec `APP_SECRET` avant tout accès
  Redis. Analytics est désactivé pour économiser les commandes. L'offre gratuite
  observée le 2026-09-02 annonce 500 000 commandes par mois et 256 Mo ; elle doit
  être revérifiée lors de `SET-07`, sans activer de dépassement payant.
- Runtime : Node.js 22 minimum en local et Node.js 24 sélectionné sur Vercel.

Les packages sont installés et compilent. Upstash, les deux modèles Gemini,
MongoDB Atlas, les 11 index standards/TTL, les deux index Search et le store
Blob privé ont été vérifiés réellement le 2026-09-02. Le repository GitHub est
connecté au projet Vercel et les variables serveur sont configurées dans les
trois environnements. Aucun mock n'est présenté comme une validation externe.

## 21. Risques et réponses prévues

| Risque | Réponse |
| --- | --- |
| Traitement trop long sur Vercel | Mesurer par étape, limiter la concurrence et ajouter une queue seulement si nécessaire. |
| Extraction Office incomplète | Fixtures représentatives et contrat normalisé testé parser par parser. |
| XLSX trop volumineux | Limite de cellules et conversion contrôlée des feuilles. |
| Mauvaise pertinence RAG | Jeu d'évaluation, paramètres ajustés sur résultats, puis hybride. |
| Hallucination | Seuil de pertinence, prompt de refus et sources obligatoires. |
| Fuite entre sessions | Filtre `sessionId` et `documentId` sur toutes les opérations. |
| Dépendance externe indisponible | Timeout, erreur structurée, retry ciblé et état partiel du batch. |
| Dérive de périmètre pendant la journée | Ce document reste la référence et toute extension attend une validation. |

## 22. Définition de terminé

Le projet est terminé uniquement lorsque :

- Les exigences F1 à F6 fonctionnent sur l'URL Vercel publique.
- Tous les formats du périmètre sont validés avec une fixture.
- Un batch multi-fichiers peut réussir partiellement et être relancé.
- Le chat multi-documents répond en streaming.
- Le chat reste bloqué tant qu'un fichier conservé n'est pas `ready`.
- Les réponses absentes sont refusées explicitement.
- Les sources affichent le fichier, l'emplacement, l'extrait et le score.
- Les secrets ne sont pas exposés au client.
- Le rate limiting et les logs structurés sont actifs.
- `pnpm check` et `pnpm build` réussissent.
- Le test end-to-end principal réussit.
- Les cinq questions d'évaluation et leurs résultats sont versionnés.
- Le README explique l'architecture, les compromis, le lancement et les
  variables d'environnement.
- Le repository Git contient un historique atomique et lisible.
- L'application déployée est testée dans une session navigateur propre.
- Les animations manuelles représentent correctement chaque opération,
  fonctionnent avec `prefers-reduced-motion` et ne montrent aucun faux progrès.

## 23. Journal des décisions

| Date | Décision |
| --- | --- |
| 2026-09-01 | Utiliser une seule application Next.js et un seul repository. |
| 2026-09-01 | Éviter toute abstraction ou optimisation sans problème concret. |
| 2026-09-02 | Étendre l'upload à un batch multi-fichiers et multi-formats. |
| 2026-09-02 | Supporter PDF, DOCX, PPTX, XLSX, TXT, Markdown et CSV. |
| 2026-09-02 | Utiliser MongoDB Atlas pour la persistance et le retrieval. |
| 2026-09-02 | Utiliser Vercel Blob pour les fichiers originaux. |
| 2026-09-02 | Conserver le streaming frontend comme exigence obligatoire. |
| 2026-09-02 | Utiliser des agents IA sur des tâches bornées et sans commits concurrents. |
| 2026-09-02 | Définir `ready` comme la réussite complète de l'upload, de l'extraction, du chunking, des embeddings et de leur persistance. |
| 2026-09-02 | Bloquer le chat jusqu'à ce que chaque fichier conservé soit `ready`. |
| 2026-09-02 | Utiliser une UI sobre avec des animations CSS/SVG manuelles et spécifiques à chaque opération. |
| 2026-09-02 | Conserver trois limites indépendantes : 10 fichiers, 10 MiB par fichier et 50 MiB par batch. |
| 2026-09-02 | Envoyer les fichiers directement vers Blob privé avec une seule action utilisateur et une concurrence navigateur limitée à trois. |
| 2026-09-02 | Limiter le parcours PDF initial au texte natif avec `pdf-parse` 2.4.5 ; les PDF scannés sont refusés explicitement sans OCR. |
| 2026-09-02 | Conserver provisoirement un PDF partiellement extractible si au moins une page contient du texte ; les pages sans texte sont ignorées jusqu'à la révision de cette règle. |
| 2026-09-02 | Adapter le contexte à `gemini-3.7-flash` : 1 048 576 tokens d'entrée, 65 536 tokens de sortie, niveau `medium` et aucun plafond fixe de chunks. |
| 2026-09-02 | Générer les vecteurs documentaires avec `gemini-embedding-2`, `RETRIEVAL_DOCUMENT`, 768 dimensions et deux appels simultanés maximum. |
| 2026-09-02 | Utiliser exclusivement les offres gratuites des services externes et refuser toute dépendance obligatoire à une capacité payante. |
| 2026-09-02 | Exécuter Vector Search et Search lexical en parallèle puis fusionner leurs rangs par RRF dans l'application avec une constante de 60. |
| 2026-09-02 | Conserver Upstash pour le rate limiting serverless partagé, avec trois limites simples, IP anonymisée, analytics désactivé et usage compatible avec l'offre gratuite. |
| 2026-09-02 | Envoyer les logs JSON vers la sortie standard : terminal en local et Runtime Logs Vercel en production, sans contenu utilisateur ni identifiant sensible. |
| 2026-09-02 | Valider réellement Upstash par `PING` et écriture/lecture/suppression temporaire, puis Gemini par génération 3.7 Flash et embedding 768 dimensions ; conserver les secrets uniquement dans `.env.local`. |
| 2026-09-02 | Valider Atlas par connexion et cycle CRUD temporaire, créer 3 collections, 11 index standards/TTL et les index Search vectoriel/lexical, puis prouver les deux recherches filtrées avant de supprimer la fixture. |
| 2026-09-02 | Centraliser toutes les actions et explications documentaires dans le panneau gauche ; réserver la surface centrale au pipeline, à l'information compacte et au chat. Ne pas répéter le bloc des limites dans le panneau. |
| 2026-09-03 | Utiliser l'icône Smartly.ai fournie comme marque et favicon, composer le nom en texte noir/blanc selon le thème et supprimer le sous-titre du header. |
| 2026-09-03 | Remplacer le badge générique `Pipeline overview` par une signature Gemini professionnelle reliée à la configuration réelle du modèle. |
