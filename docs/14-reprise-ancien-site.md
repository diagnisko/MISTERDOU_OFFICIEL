# Reprise des données de l'ancien site (Vanta)

L'ancien site **Vanta** est fait avec Next.js et Prisma, sa base est sur **Neon** et ses fichiers sur
**AWS S3** (un bucket public pour les photos et vidéos, un bucket privé pour les pièces
d'identité). C'est une **copie** : l'ancien site reste en ligne et n'est jamais modifié, car
toutes les lectures se font en lecture seule. Le jour venu, le propriétaire fait pointer
son nom de domaine vers le nouveau site.

## Ce que fait la copie

| Ancien site | Nouveau site |
|---|---|
| Clients (rôle CLIENT, et l'ancien vendeur) | Comptes clients. Les comptes de l'équipe (SUPER_ADMIN, MANAGER) ne sont pas copiés. |
| Mots de passe (bcrypt) | Repris tels quels, puis convertis en scrypt à la première connexion (`lib/password.ts`). |
| Inscrits par Google | `googleSub` repris : connexion par Google, ou code « mot de passe oublié ». |
| Téléphone, pays, adresse, photo de profil | Repris. Un numéro porté par deux comptes ne reste que sur le premier. |
| Clients vérifiés (pièce recto/verso + photo du visage) | Dossier d'identité VERIFIED, avec les pièces rangées chiffrées (`lib/storage.ts`). Un dossier incomplet est à refaire. |
| Offres liées à des mensualités en cours | Offres MISTERDOU « vendues », avec leurs identifiants chiffrés. |
| Offres encore en vente | Offres « brouillon » (masquées) jusqu'à la bascule, pour qu'un compte ne soit jamais vendu deux fois. |
| Photos et vidéos | Copiées vers R2. Les vidéos .mov sont converties en .mp4 avec ffmpeg. |
| Mensualités dont l'apport est payé | Commande « mensualités en cours » : apport payé, mêmes dates et montants (au franc près). |
| Réservations sans apport, messages, notifications, journaux | Non copiés : ils restent sur l'ancien site. |

Sur le nouveau site, un client ne voit les identifiants qu'une fois tout payé. C'est la même
règle pour les commandes copiées, même si l'ancien site les a déjà remis.

**Avant la bascule :**
- le réglage interne `legacy.followOldSite` vaut `true` (`src/legacy/follow.ts`) ;
- le nouveau site n'envoie aucun rappel pour les échéanciers copiés, ne les marque jamais « en retard » et refuse de les encaisser (`LEGACY_PLAN`). L'ancien site continue d'encaisser.

## Accès à l'ancien site

Le fichier d'accès est cherché dans cet ordre : `LEGACY_ENV_FILE`, `C:\ancien-site\migration.env`, puis
`Bureau\ancien-site\migration.env`. Ce peut être le `.env` de l'ancien site tel quel : `DATABASE_URL`,
`AWS_*`, `S3_BUCKET_PUBLIC` et `S3_BUCKET_PRIVATE` sont reconnus. Les rapports sont écrits dans
`rapports\`, à côté du fichier ; ils contiennent des adresses e-mail.

La clé AWS doit pouvoir **lire** les deux buckets. La clé applicative de Vanta ne peut pas lire
le bucket privé : pour les pièces d'identité, il faut une clé IAM avec `AmazonS3ReadOnlyAccess`,
à supprimer une fois la copie faite.

## Commandes

```
pnpm --filter @misterdou/api legacy:import                         # simulation : rien n'est écrit
pnpm --filter @misterdou/api legacy:import -- --apply              # copie (relançable, sans doublon)
pnpm --filter @misterdou/api legacy:import -- --apply --bascule    # au changement de domaine
```

- **Essai local** : avec `DATABASE_URL=postgresql://…@localhost:5433/…`. Rien n'est écrit dans R2 : les fichiers vont sur le disque (`STORAGE_DIR`).
- **Production** : ajouter `--production`. La commande refuse toute base non locale sans ce drapeau, et vérifie que la clé de chiffrement locale est bien celle de la production avant d'écrire.
- **Nouveau passage** : il rattrape les nouveaux clients, les mois payés sur l'ancien site et les médias ou pièces manqués.
- **`--bascule`** : il publie les offres encore en vente et rend les mensualités au nouveau site (rappels, retards, paiements).

## Mot de passe oublié

C'est un code à 6 chiffres envoyé par e-mail :
- valable 15 minutes, avec 5 essais au maximum ;
- un seul code valable à la fois, et pas plus d'un code par minute ;
- le code reçu confirme aussi l'adresse e-mail.

Le lien créé depuis la console (fiche du client) reste disponible tant que l'envoi d'e-mails n'est pas configuré.
