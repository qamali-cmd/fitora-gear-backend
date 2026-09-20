# Fitora Gear - Admin System

## Structure
```
database/schema.sql        - MySQL schema + sample data
services/auth-service/     - Node.js API - admin login (port 4000)
services/product-service/  - Node.js API - products & categories (port 4001)
services/order-service/    - Node.js API - orders (port 4002)
admin-web/                 - Vanilla HTML/CSS/JS admin website (frontend only)
```

Ang **admin-web** ay purong HTML, CSS, at JavaScript lang - walang framework,
walang Node.js sa loob nito. 3 files lang ito: `index.html`, `style.css`,
`script.js`. Tumatawag ito (gamit ang `fetch()`) sa 3 backend services para
makakuha/makapag-save ng data sa MySQL database.

## Paano i-run (unang beses)

### 1. I-set up ang database
1. Buksan ang MySQL Workbench, kumonekta sa local MySQL server mo
2. File → Open SQL Script → piliin ang `database/schema.sql`
3. I-click ang lightning bolt icon (Execute)
   - Default admin account: **username: `admin`**, **password: `admin123`**

### 2. I-run ang tatlong backend services
Kailangan mo munang naka-install ang [Node.js](https://nodejs.org).
Bukas ka ng 3 hiwalay na terminal window (isa per service):

```bash
# Terminal 1
cd services/auth-service
npm install
cp .env.example .env      # ilagay ang totoong MySQL password mo dito
npm start                 # http://localhost:4000

# Terminal 2
cd services/product-service
npm install
cp .env.example .env
npm start                 # http://localhost:4001

# Terminal 3
cd services/order-service
npm install
cp .env.example .env
npm start                 # http://localhost:4002
```

### 3. Buksan ang Admin Web
I-double click lang ang `admin-web/index.html`, o gamitin ang **Live Server**
extension sa VS Code (mas maganda ito para gumana nang tama ang fetch
requests). I-try mag-login gamit ang `admin` / `admin123`.

## Paano mag-edit
Hinanap mo na lang ang mga linyang may komentong "**EDIT DITO**" sa
`index.html`, `style.css`, at `script.js` - dun nakatakda ang mga bagay na
malamang babaguhin mo (pangalan ng company, kulay, API URLs pagka-deploy).

## Susunod na maaring gawin
- [ ] I-deploy ang 3 services sa isang free hosting (hal. Render, Railway)
- [ ] I-update ang mga API URLs sa `script.js` papuntang deployed URLs
- [ ] I-publish ang admin-web sa free static hosting (hal. Netlify, GitHub Pages)
- [ ] Client/User side ng system (mobile app o web) - susunod na gagawin

## Architecture
```
Admin Web (HTML/CSS/JS) --> Auth Service (Node.js, :4000)     -+
                        --> Product Service (Node.js, :4001)   |--> MySQL Database
                        --> Order Service (Node.js, :4002)    -+
```

Bawat backend service ay hiwalay na Node.js app na may sariling port - ito
ang "microservice" approach na required sa project. Ang frontend
(admin-web) mismo ay hindi apektado ng pagpili ng backend technology -
purong HTML/CSS/JS lang siya.
