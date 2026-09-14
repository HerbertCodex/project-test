# Polices embarquées

Servies par l'application depuis `/fonts/` (aucun CDN, compatible avec la CSP `self`).
Sous-ensemble `latin` uniquement (couvre le français, œ et €).

| Fichiers | Police | Licence | Provenance |
|---|---|---|---|
| `cormorant-garamond-latin-{400,500,600,700}-normal.woff2`, `cormorant-garamond-latin-{400,500}-italic.woff2` | Cormorant Garamond | SIL OFL 1.1 (`OFL-cormorant-garamond.txt`) | npm `@fontsource/cormorant-garamond@5.3.0`, integrity `sha512-weuGsCirGVWBWqpt6YUp0yLThTe4G8YO45noq8wxeJCRvEpq5lFrxNMFSTxcyOyV5k5otzJ8guDzYegdYlcLMQ==` |
| `inter-latin-wght-normal.woff2`, `inter-latin-wght-italic.woff2` (variables, graisses 100–900) | Inter | SIL OFL 1.1 (`OFL-inter.txt`) | npm `@fontsource-variable/inter@5.3.0`, integrity `sha512-OupL48va4JNofb97w6NYeF9S7W/kHNKM0Er8Dem5nqi4jeOLrVJDoE8tZEpnMJmtkvNbB1EIPPwHcdkF6b1oUA==` |

Aucun paquet npm n'est ajouté aux dépendances : seuls les fichiers de police et leurs licences sont copiés.
