# Reprise des données de l'ancien site

L'ancien site garde sa base sur **Supabase** et ses fichiers sur **AWS S3** (un bucket
public, un bucket privé). La reprise copie ces données dans MISTERDOU sans jamais
modifier l'ancien site : toutes les lectures se font en lecture seule.

## Ce qui est déjà prêt

| Élément | Où | Rôle |
|---|---|---|
| Mots de passe des anciens clients | `apps/api/src/lib/password.ts` | Les empreintes bcrypt de Supabase Auth sont acceptées à la connexion, puis remplacées par scrypt. Les clients gardent leur mot de passe. |
| Mot de passe oublié | `apps/api/src/modules/auth/password-reset.ts`, page `/mot-de-passe-oublie` | Code à 6 chiffres par e-mail : 15 minutes, 5 essais, un code par minute, un seul code valable à la fois. Le code reçu confirme aussi l'adresse e-mail. |
| Table `LegacyRef` | `packages/db/prisma/schema.prisma` | Correspondance « ligne de l'ancien site → ligne du nouveau ». Le transfert peut être relancé sans créer de doublon. |
| Import des comptes | `apps/api/src/legacy/supabase-users.ts` | Lit `auth.users` et `auth.identities` (Google). |
| Commande | `pnpm --filter @misterdou/api legacy:import` | Simulation par défaut, `--apply` pour écrire. |

Le lien de nouveau mot de passe créé depuis la console (fiche du client) reste disponible :
il sert tant que l'envoi d'e-mails n'est pas configuré.

## Accès à l'ancien site

Les accès sont rangés dans un fichier local, **hors du dépôt et hors de OneDrive** :
`C:\ancien-site\migration.env`. Un autre chemin peut être indiqué avec `LEGACY_ENV_FILE`.

```
SUPABASE_DB_URL=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
S3_PUBLIC_BUCKET=
S3_PRIVATE_BUCKET=
```

- **`SUPABASE_DB_URL`** : dans Supabase, bouton « Connect », puis « Session pooler ». Remplacer `[YOUR-PASSWORD]` par le mot de passe de la base.
- **Clés AWS** : créer un utilisateur IAM `misterdou-migration` avec seulement `AmazonS3ReadOnlyAccess`. Supprimer sa clé une fois la reprise terminée.
- **Rapports** : ils sont écrits dans `C:\ancien-site\rapports\`. Ils contiennent des adresses e-mail : ne pas les partager.

## Déroulé

C'est une **copie**, pas un déménagement : l'ancien site reste en ligne et continue de
fonctionner. Le moment venu, le propriétaire fait pointer son nom de domaine vers le
nouveau site. Juste avant, une nouvelle copie rattrape ce qui a changé entre-temps,
sans créer de doublon.

1. **Essai sur la base de test locale** (port 5433). Lancer d'abord une simulation, puis l'écriture :
   ```
   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/misterdou_test?schema=public pnpm --filter @misterdou/api legacy:import
   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/misterdou_test?schema=public pnpm --filter @misterdou/api legacy:import -- --apply
   ```
2. **Vérification** sur l'aperçu local : comptes présents, connexion avec un ancien mot de passe, soldes.
3. **Copie sur le nouveau site** : sauvegarder Neon en créant une branche, puis lancer avec `--production` en plus de `--apply`. La commande refuse toute base non locale sans ce drapeau. Comme `apps/api/.env` vise Neon, c'est ce garde-fou qui empêche une écriture par erreur.
4. **Avant la bascule du nom de domaine** : relancer la copie pour rattraper les nouveaux clients et les mensualités payées sur l'ancien site, puis rendre au nouveau site le suivi des échéances.

## Mensualités en cours

Les comptes vendus en mensualités sont copiés avec leurs **dates d'échéance d'origine**.
Tant que l'ancien site encaisse, le nouveau site ne doit ni envoyer de rappel ni marquer de
retard pour ces échéanciers copiés. Sans ça, le job des échéances
(`markOverdueInstallments`, `sendInstallmentReminders`) les passerait en retard. Ce suivi est
rendu au nouveau site au moment de la bascule.

## Règles de l'import des comptes

| Cas | Résultat |
|---|---|
| Nouveau client | Compte CLIENT créé : e-mail, prénom/nom (métadonnées), date d'inscription, e-mail vérifié, identité Google. |
| Adresse déjà inscrite sur le nouveau site | Comptes fusionnés : le mot de passe du nouveau site est gardé, l'ancien sert seulement s'il n'y en a pas. |
| Adresse d'un compte de l'équipe (ADMIN/STAFF) | Ignoré : on ne fusionne jamais avec un compte de l'équipe. |
| Compte supprimé, anonyme ou sans e-mail | Ignoré, avec la raison dans le rapport. |
| Banni sur l'ancien site | Compte repris en « Suspendu ». |
| Inscrit uniquement par Google | Pas de mot de passe : se connecte par Google ou fixe un mot de passe via « Mot de passe oublié ». |
| Nouveau passage (transfert final) | Aucun doublon. Le mot de passe suit l'ancien site tant que le client ne s'est pas connecté sur le nouveau. |

## Reste à faire (après lecture du code de l'ancien site)

- Correspondance des tables métier : profils (téléphone), vendeurs et soldes, offres, identifiants des comptes eFootball (à chiffrer de nouveau), commandes, paiements, échéances, avis.
- Commandes en cours au moment du basculement : règle à décider avec le propriétaire.
- Fichiers S3 :
  - le bucket public est copié tel quel vers R2 ;
  - le bucket privé passe par le chiffrement de `apps/api/src/lib/storage.ts`, jamais par une copie brute.
