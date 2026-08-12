# Benchmark Backend: API & Scraper Projects Detail

Yeh document Benchmark system mein chalne walay tamam 20 API aur Scraper projects ki tafseel faraham karta hai, taake asani se samajh aa sake ke kon sa project kahan se data lata hai aur kaisay kaam karta hai.

---

## Project 1: Focal CRM FP (API)

Yeh `FocalCrmService.php` file mein likha gaya hai. Yeh ek modern, direct API Integration hai jo FocalAgent system se Floor Plan (Propertyvision) ke orders fetch karta hai.

**Kaisay Kaam Karta Hai?**

- **API Call:** Yeh service `api.focalagent.com/supplier-enhancement/v3/jobs` par request bhejti hai.
- **Security:** API call karne ke liye yeh specific Supplier-Secret aur Subscription-Key use karta hai.
- **Data Filtering:** Sirf woh jobs filter karta hai jinki product type "Propertyvision" ho.
- **Database Saving:** Data `project_1_orders` table mein map karke insert ya update kar deta hai.
- **Images:** Order save hone ke baad yeh assets ke links nikal kar `job_detail_1_images` mein save karta hai.
- **Accept Job:** Aakhir mein yeh Focal API ko "Accept" bhejta hai taake unhein pata chal jaye ke job receive karli hai.

---

## Project 2: Focal PB FP (Scraper)

Yeh `FocalPb2ScraperService.php` file mein likha gaya hai. Focal PropertyBox (PB) ka direct API nahi hai, isliye yeh ek Web Scraper (Bot) ke tor par kaam karta hai.

**Kaisay Kaam Karta Hai?**

- **Login:** Yeh Microsoft Azure website par `focal.matterport@benchmarkstudio.biz` se automatically login karta hai.
- **Data Scraping:** Login hone ke baad yeh bot `/PropertyVision` pages kholta hai aur wahan se HTML tables ko parhta hai.
- **Smart Priority:** Table se "Time Left" (Baqi waqt) parhta hai. Agar 6 ghante se kam hain toh Urgent, 6-24 ghante mein High, warna Normal set karta hai.
- **Database Saving:** Data ko duplicate check karne ke baad `project_2_orders` mein save kar deta hai.

---

## Project 3: Focal MP FP (Scraper)

Yeh project `ScrapeMatterport.php` ke zariye kaam karta hai. Yeh bhi ek mukammal Web Scraper (Bot) hai.

**Kaisay Kaam Karta Hai?**

- **Scraper System:** Yeh bilkul Project 2 jaisa hi hai aur wahi Matterport email (focal.matterport@) use kar ke Focal ke portal mein jata hai.
- **Data Saving:** Yeh naye aur processing orders ki table copy karta hai, unka due time calculate karta hai aur as a `FP_3_LAYER` task database mein `project_2_orders` mein hi save kar leta hai.

---

## Project 5: UK Focal Xactimate (Scraper)

Yeh `FocalXactimateScraperService.php` mein likha hai aur yeh Project 2 (Focal PB FP) ka lag-bhag judwaa bhai hai.

**Kaisay Kaam Karta Hai?**

- **Website:** Yeh wahi Azure portal use karta hai.
- **Farq:** Project 2 "PropertyVision" ke page par jata tha, lekin Project 5 "Xactimate" wale page par ja kar orders nikalta hai.
- **Database Saving:** HTML scrape karne ke baad yeh apna data `project_5_orders` table mein save karta hai.

---

## Project 6: Aus Metro Xactimate (API)

Iska code `MetroExecutiveImportService.php` ke andar likha hua hai. Yeh scraper nahi, balkay JSON API ka istemal karta hai.

**Kaisay Kaam Karta Hai?**

- **Data Source:** `https://es-portal.captur3d.io/external_supplier/trueplan_orders.json`.
- **Security:** Yeh Bearer Token bhej kar, ya Basic Auth, ya majboori mein Session cookies ke zariye connect hota hai.
- **Sorting:** JSON data aane par yeh Xactimate wale orders ko `project_6_orders` mein daal deta hai.

---

## Project 12: SA FP (API)

Yeh `SaFPImportService.php` mein likha hua hai aur seedha JSON API use karta hai.

**Kaisay Kaam Karta Hai?**

- **API URL:** Yeh "Base44 Diary Booking" system ko hit karta hai aur `processor_id=11441` (SA FP team) bhejta hai.
- **Filtering:** Sirf Floorplan (Product ID 3) orders ko aage le kar jata hai.
- **Time Calculation:** Order ke received time mein theek 12 ghante plus kar ke Due Time banata hai.
- **Database Saving:** Data ko `project_12_orders` mein insertOrIgnore se save kar deta hai.

---

## Project 13: Metro FP (API)

Yeh bhi `MetroExecutiveImportService.php` use karta hai (100% same engine as Project 6).

**Kaisay Kaam Karta Hai?**

- **Logic:** Yeh wahi same Captur3d JSON API hit karta hai jo Project 6 karta hai.
- **Farq:** Yeh script specifically "Floorplan" wale orders ko chhan kar `project_13_orders` mein store karta hai.

---

## Project 15: Roomio FP (API / Hybrid)

Iska code `RoomioImportService.php` mein hai. Isay "Hybrid System" keh sakte hain kyunke yeh API aur Scraper dono hai.

**Kaisay Kaam Karta Hai?**

- **Connection:** Pehle Bearer Token se API connect karne ki koshish karta hai, na ho toh website login karke HTML parhna shuru kar deta hai.
- **Data Parsing:** JSON aur HTML dono ko parhne ki salahiyat rakhta hai.
- **Database Saving:** Waqt (priority) nikal kar data `project_15_orders` mein save kar deta hai.

---

## Project 17: BR Photos (API)

Iska code `BrPhotoService.php` mein hai aur yeh eHouse ka system hai.

**Kaisay Kaam Karta Hai?**

- **Security:** Yeh Microsoft Azure OAuth 2.0 (Access Token) use karta hai jo bohat secure hai.
- **Data Fetching:** API se saaf JSON format mein photography orders lata hai.
- **Priority System:** "Priority Client" ya level 5 clients ko automatically Urgent/High mark karta hai.
- **Database Saving:** Client ki visit date ko due date bana kar `project_17_orders` mein mehfooz kar leta hai.

---

## Project 19: SA Photos (API)

Yeh `SaPhotoService.php` mein likha hai aur bilkul Project 12 ka bhai hai.

**Kaisay Kaam Karta Hai?**

- **API URL:** Base44 Diary Booking API use karta hai.
- **Processor ID:** Yeh specifically `processor_id=6284` (Asbah Iqbal - Photos) ke orders uthata hai.
- **Wall Clock Time:** Timezone ke errors se bachne ke liye portal ke time ko waise ka waise hi received_at manta hai, aur 12 ghante baad ka due time deta hai.
- **Database Saving:** `project_19_orders` mein `PH_2_LAYER` tag ke sath save karta hai.

---

## Project 22: Focal CRM Photos (API)

Yeh `FocalCrmPhotoService.php` mein hai aur FocalAgent ki API se chalta hai.

**Kaisay Kaam Karta Hai?**

- **Filtering:** Sirf Photography, Drone, aur Streetscape jaise orders select karta hai.
- **Time Calculation:** Agar images 20 se zyada hon toh 6 ghante, warna 3 ghante ka waqt set karta hai.
- **Images & Accept:** Order aur tasweeron ko `project_22_orders` aur `job_detail_22_images` mein save karne ke baad hi portal par job "Accept" karta hai taake data miss na ho.

---

## Project 24: Focal PB Photos (Scraper)

Yeh `FocalPbPhotoScraperService.php` mein likha hai aur yeh ek pura Bot (Scraper) hai.

**Kaisay Kaam Karta Hai?**

- **Login:** Yeh `sajid@benchmarkstudio.biz` account se TLC portal par login karta hai.
- **Deep Scraping:** Table parhne ke ilawa, yeh har order ke "Details" page par andar ja kar tasweeron (images) ke URLs bhi nikal lata hai.
- **Database Saving:** Priority (Time Left) set karke data `project_24_orders` mein save karta hai.

---

## Project 25: RAW Prestige (API)

Yeh `FocalCrmPrestigeService.php` mein hai aur Project 22 (Focal CRM) jaisa hi hai.

**Kaisay Kaam Karta Hai?**

- **Farq:** Yeh API se sirf aur sirf "Prestige Photography" (VIP photo orders) uthata hai.
- **Database Saving:** Baki sara process same hai. Data `project_25_orders` aur images ko `job_detail_25_images` mein dalta hai aur phir job Accept karta hai.

---

## Project 26: Focal RTV (API)

Yeh `FocalRtvService.php` mein chalta hai aur Focal ke fesp-int API se data lata hai.

**Kaisay Kaam Karta Hai?**

- **Deep Image Extractor:** RTV walon ke image links kafi lambe (nested JSON) hotay hain. Yeh script deeply ja kar in links ko nikalta hai.
- **Storage:** Tasweeron ke barey links ki wajah se automatically column size adjust karke `project_26_orders` aur `job_detail_26_images` mein safely store karta hai.

---

## Project 27: Faro (API / Hybrid)

Yeh `FaroImportService.php` mein hai aur Captur3D portal se Faro 3D scans uthata hai.

**Kaisay Kaam Karta Hai?**

- **Dual Parsing:** Portal ki marzi hai ke woh JSON de ya HTML page de, yeh script dono ko parh sakta hai.
- **Database Saving:** Data ko `project_27_orders` mein `FP_3_LAYER` aur `drawer` tag ke sath save karta hai.

---

## Project 49: Metro Photos (API)

Yeh bhi `MetroExecutiveImportService.php` use karta hai (Project 6 & 13 jaisa).

**Kaisay Kaam Karta Hai?**

- **Logic:** Master script JSON API (trueplan_orders) ko hit karta hai.
- **Farq:** Is baar yeh "Photos" wale orders ko chhan kar `project_49_orders` mein daal deta hai.

---

## Project 52: Focal AI (API)

Yeh `FocalAiImportService.php` mein hai aur Focal ke naye AI platform se jurta hai.

**Kaisay Kaam Karta Hai?**

- **JWT Token:** Isme password nahi, balkay ek lamba JWT token use hota hai.
- **Lists:** Yeh ek request Complete aur doosri Incomplete jobs mangwane ke liye karta hai.
- **Images Count:** Tasweeron ki tadaad par due time (3 ya 6 ghante) tay karta hai.
- **Database Saving:** Safe mode mein `project_52_orders` mein dalta hai aur Focal AI par Job Accept ka thappa (status update) lagata hai.

---

## Project 55: iGUIDE (API / Hybrid)

Yeh `IGuideImportService.php` mein hai. Project 27 (Faro) ka judwaa bhai hai.

**Kaisay Kaam Karta Hai?**

- **Portal:** Yeh Captur3D portal par specifically iGUIDE wale orders target karta hai.
- **Database Saving:** Data aur priority calculate karke safely `project_55_orders` mein daal deta hai.

---

## Project 56: Realsee (API / Hybrid)

Yeh `RealseeImportService.php` mein hai aur yeh bhi Captur3D / Faro / iGuide series ka hissa hai.

**Kaisay Kaam Karta Hai?**

- **Portal:** Yeh Captur3D portal par "Realsee" floorplans ko filter kar ke lata hai.
- **Database Saving:** Data ko nikal kar `project_56_orders` mein daal deta hai.

---

## Project 57: SA Video (API)

Yeh `SaVideoService.php` mein hai aur bilkul Project 12 / 19 jaisa hi hai.

**Kaisay Kaam Karta Hai?**

- **Processor ID:** Base44 server ko hit karke strictly `processor_id=11420` (Video Editing) ke orders mangwata hai.
- **Database Saving:** Seedha JSON se video titles, notes nikal kar `project_57_orders` mein record save kar leta hai.

---

## Standalone / Manual Projects (No API)

Yeh woh projects hain jinme koi automatic system (API ya Web Scraper) nahi laga hua. In projects ke naye orders (kaam) system khud internet se fetch nahi karta, balki management (PM/OM) ko khud Excel/CSV file upload karke ya manual entry ke zariye system mein daalne padte hain taake un par aage kaam kiya ja sake.

---

### Project 4: Schematic FP
**`4,Schematic FP,No,-,"Standalone project. No automated scraping or external API integration exists in the backend for this project."`**

Yahan is line ka pura matlab yeh hai:
1. **Project ID (4)**: Is project ka ID number 4 hai.
2. **Project Name (Schematic FP)**: Is project ka naam "Schematic FP" hai (FP shayad Floor Plan ke liye use hota hai).
3. **Has Client API (No)**: Kya is project mein koi Client API integration hai? "No", isme nahi hai.
4. **Source Script (-)**: Iske liye backend mein koi specific script run nahi ho rahi.
5. **Detailed Operation ("Standalone project...")**: Yeh ek standalone project hai. Iska matlab is project ka data backend mein kisi external website se scrape nahi hota aur na hi kisi external API se automatically fetch hota hai. Yeh mostly manual kaam ke liye hoga jahan data khud enter ya manage kiya jata hai. 

Muntashir (Short) alfaaz mein: Project 4 (Schematic FP) ek aisa project hai jisme koi automation ya API connect nahi hai, yeh backend mein khud se kisi aur system ka data nahi laata.

---

### Project 7: GF FP
**`7,GF FP,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (7)**: Is project ka ID number 7 hai.
2. **Project Name (GF FP)**: Is project ka naam "GF FP" hai.
3. **Has Client API (No)**: Isme bhi koi API integration nahi hai.
4. **Source Script (-)**: Iske liye bhi koi script nahi hai.
5. **Detailed Operation ("Standalone project...")**: Yeh bhi ek standalone project hai, bilkul pichle waale ki tarah. Iska data bhi kahin bahar se (kisi API ya scraping ke zariye) automatically fetch nahi hota.

---

### Project 8: Single FP
**`8,Single FP,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (8)**: Yeh is project ka unique ID (number) hai database mein. System isko project number 8 ke naam se janta hai.
2. **Project Name (Single FP)**: Yeh is project ka naam hai. "Single FP" se murad shayad "Single Floor Plan" ho sakti hai.
3. **Has Client API (No)**: Yeh sabse important baat hai. "No" ka matlab hai ke is project ka data kisi bahar ki website ya client ke system (jaise kisi doosri company ka API) se automatically connect hoke nahi aa raha.
4. **Source Script (-)**: Agar yeh project automated hota, toh yahan us PHP file (script) ka naam likha hota. Kyun ke yeh automated nahi hai, isliye yahan sirf dash (-) laga hua hai yani koi script nahi hai.
5. **Detailed Operation ("Standalone project...")**: Iska matlab hai yeh project khud-mukhtar hai. Yeh kisi aur external system par depend nahi kar raha. "No automated external fetch" ka matlab hai ke is project mein naye orders ya data khud-ba-khud bahar se uth kar nahi aate.

---

### Project 9: CAD FP
**`9,CAD FP,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (9)**: Is project ka system mein ID 9 hai.
2. **Project Name (CAD FP)**: Is project ka naam "CAD FP" hai (Shayad Computer-Aided Design Floor Plan).
3. **Has Client API (No)**: Isme koi API nahi lagi hui.
4. **Source Script (-)**: Koi automated PHP script iske liye nahi chal rahi.
5. **Detailed Operation**: Yeh bhi ek "Standalone project" hai, yaani iska data aur orders kisi doosri jagah se automatically fetch (download/sync) nahi hote. Yeh totally manual process par chalta hoga.

---

### Project 10: Code FP
**`10,Code FP,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (10)**: Is project ka ID number 10 hai.
2. **Project Name (Code FP)**: Is project ka naam "Code FP" hai.
3. **Has Client API (No)**: Isme koi API nahi hai.
4. **Source Script (-)**: Koi automation script nahi hai.
5. **Detailed Operation**: Yeh bhi ek standalone (manual) project hai jiska data khud ba khud kahin se nahi aata.

---

### Project 11: BR FP
**`11,BR FP,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (11)**: Is project ka system ID 11 hai.
2. **Project Name (BR FP)**: Is project ka naam "BR FP" hai (BR shayad kisi specific client ya kaam ki type ka naam hai, maslan 'Bedroom' ya kisi client ka shortcode, aur FP yani Floor Plan).
3. **Has Client API (No)**: Isme bhi koi automatic API connect nahi hai.
4. **Source Script (-)**: Koi backend code ya script nahi chal rahi isko fetch karne ke liye.
5. **Detailed Operation**: Yeh bhi ek manual (standalone) project hai. Yani iske orders bhi API ke bajaye khud CSV upload karke ya manual entry se banaye jate hain.

---

### Project 14: AUS Others FP
**`14,AUS Others FP,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (14)**: System mein is project ki pehchan (ID) 14 hai. Database isko 14 number se janta hai.
2. **Project Name (AUS Others FP)**: 
   * **AUS**: Yeh shayad "Australia" ke kisi client ya wahan ke projects ke liye use hota hai.
   * **Others**: Iska matlab yeh kisi ek specific badi company ka kaam nahi hai, balki Australia ke chhote-mote ya mutafarriq (miscellaneous) clients ka mila-jula kaam ho sakta hai.
   * **FP**: Floor Plan. Yani is project mein bhi 2D/3D nakshey banane ka kaam kiya jata hai.
3. **Has Client API (No)**: Is project ka kisi Australian website ya client API ke sath automatic connection nahi hai. Data wahan se khud ba khud nahi aata.
4. **Source Script (-)**: Kyun ke yeh automated nahi hai, isliye iska koi apna backend code (PHP file) nahi chal raha jo rozana data fetch kare.
5. **Detailed Operation ("Standalone project...")**: Yeh ek bilkul Manual Project hai. Australia ke in "other" clients ke jo bhi naye orders hote hain, aapki management team unki tafseel ko kisi Excel ya CSV file mein dal kar system mein manually upload karti hogi, ya ek ek order khud type karke banati hogi.

---

### Project 16: Cubi FP
**`16,Cubi FP,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (16)**: System mein is project ka ID number 16 hai.
2. **Project Name (Cubi FP)**: 
   * **Cubi**: Yeh kisi specific client ya technology ka naam ho sakta hai (Maslan 'CubiCasa', jo ke floor plan banane ki ek kaafi mashhoor app hai jisme phone se scan karke floor plan banta hai).
   * **FP**: Floor Plan. Yani is project mein bhi aapke "Drawers" in Cubi scans ya kachi drawings ko dekh kar professional 2D/3D floor plans banate hain.
3. **Has Client API (No) & Source Script (-)**: Iska matlab hai ke CubiCasa (ya jo bhi Cubi client hai) uske orders aapke system mein automatically kisi code (API) ke zariye nahi aate. Iske liye koi script nahi lagi hui.
4. **Detailed Operation ("Standalone project...")**: Kyunki automation nahi hai, isliye yeh bhi ek Manual (Standalone) project hai. Jaisa ke AUS Others FP mein bataya, is Cubi FP ke orders bhi aapki management ya PM ko khud Excel (CSV) file banakar system mein upload karne padte.

---

### Project 20: Code Photos
**`20,Code Photos,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (20)**: System mein is project ka ID number 20 hai.
2. **Project Name (Code Photos)**: 
   * **Code**: Yeh kisi specific client, company, ya kaam ki kisi khaas type ka naam hai.
   * **Photos**: Yahan farq aata hai! Pichle jin projects mein "FP" (Floor Plan) tha, unme nakshey banaye jate the. Lekin is project mein Photos (Tasweer) ka zikr hai. Iska matlab hai is project mein aapki company ke "Designers" real estate properties ki tasweeron ko edit karte hain (jaise brightness theek karna, aasmaan/sky badalna, ya tasweer saaf karna).
3. **Has Client API (No) & Source Script (-)**: Is project ke orders bhi kisi automatic API ya script ke zariye system mein nahi aate.
4. **Detailed Operation ("Standalone project...")**: Yeh bhi ek Manual (Standalone) project hai. Jis tarah Floor Plan wale manual projects mein aapki team ko Excel (CSV) file upload karke orders bananane padte the, is project mein bhi tasweeron (photos) ke orders file upload karke ya manual entry se hi banaye jate hain.

---

### Project 21: Single Photos
**`21,Single Photos,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (21)**: System mein is project ka ID number 21 hai.
2. **Project Name (Single Photos)**: Iska naam "Single Photos" hai. Isme bhi aapke Designers tasweeron (photos) par kaam karte hain. "Single" se murad shayad aisi tasweerein ho sakti hain jisme multiple photos ko mila kar ek na banana ho, balki ek single photo ko hi edit ya enhance karna ho.
3. **Has Client API (No) & Source Script (-)**: Iske liye bhi koi code ya API nahi lagi hui.
4. **Detailed Operation ("Standalone project...")**: Yeh bhi ek Manual Project hai. Yani is project ke tasweeron ke naye orders aapki team ko khud system mein upload karne padte hain.

---

### Project 42: HSA FP
**`42,HSA FP,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (42)**: System mein iska ID 42 hai.
2. **Project Name (HSA FP)**: "HSA" kisi khaas client ya company ka naam hoga. Aur "FP" ka matlab phir se wahi hai: Floor Plan. Yani is project mein nakshey (drawings) banane ka kaam hota hai.
3. **Has Client API (No) & Source Script (-)**: Is client ka bhi aapke system ke sath koi automatic API connection nahi hai.
4. **Detailed Operation ("Standalone project...")**: Yeh bhi ek mukammal Manual Project hai. HSA client ke naye orders (floor plans banane ka kaam) aapki team ko khud CSV file upload karke ya form bhar ke system mein dalne padte hain, tab ja kar kisi drawer ko kaam milta hai.

---

### Project 46: Canada
**`46,Canada,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (46)**: System mein iska number 46 hai.
2. **Project Name (Canada)**: Yeh project "Canada" ke kisi client ya wahan ki properties ke liye makhsoos (dedicated) hoga.
3. **Has Client API (No) & Source Script (-)**: In Canadian orders ko laane ke liye bhi system mein koi automatic script ya API nahi lagi hui.
4. **Detailed Operation ("Standalone project...")**: Is project ke orders bhi aapki team (Project Manager) khud kisi CSV file ke zariye system mein dalti hai taake aage workers ko assign kiye ja sakein.

---

### Project 47: Single HDR
**`47,Single HDR,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (47)**: System mein is project ka number 47 hai.
2. **Project Name (Single HDR)**: "HDR" ka matlab hota hai High Dynamic Range (yeh photography ki ek technique hai jisme alag alag exposures ko mila kar ek clear tasweer banayi jati hai). Is project mein aapke Designers in tasweeron ko edit karke HDR banate hain.
3. **Has Client API (No) & Source Script (-)**: Is project ke orders kisi software ya API ke zariye khud-ba-khud system mein nahi aate.
4. **Detailed Operation ("Standalone project...")**: In HDR photos ke naye orders (kaam) ko bhi aapki team khud Excel/CSV file upload karke ya manual entry se system mein dalti hai taake designers un par kaam kar sakein.

---

### Project 48: GF PHOTO
**`48,GF PHOTO,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (48)**: System mein iska ID 48 hai.
2. **Project Name (GF PHOTO)**: "GF" kisi client ka naam hai. Yeh usi GF client ka Photo Editing ka project hai jisme tasweerein edit ki jati hain.
3. **Has Client API (No) & Source Script (-)**: Is project ke orders kisi API ya automatic system se fetch nahi hote.
4. **Detailed Operation ("Standalone project...")**: Yeh bhi ek Manual Project hai. GF client ki tasweeron ke orders bhi aapki team khud CSV ke zariye system mein dalti hai taake designers un par kaam kar sakein.

---

### Project 50: HSA PHOTOS
**`50,HSA PHOTOS,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (50)**: Aapke system ke database mein is project ka number ya ID 50 hai.
2. **Project Name (HSA PHOTOS)**: 
   * **HSA**: Yeh ek khaas client ya company ka naam hai. 
   * **PHOTOS**: Iska matlab is project mein bhi sirf tasweeron (photos) की editing ka kaam hota hai. Aapke designers HSA client ki bheji hui tasweeron ko clear ya enhance karte hain.
3. **Has Client API (No)**: Is HSA client ne apna system aapke system se kisi automatic API ke zariye connect nahi kiya hua.
4. **Source Script (-)**: Kyunki automation nahi hai, isliye iske orders laane ke liye backend mein koi bhi code ya PHP script nahi bani hui.
5. **Detailed Operation ("Standalone project...")**: Yeh ek Manual (Standalone) Project hai. HSA client ki taraf se jab bhi naye orders (photos edit karne ke liye) aate hain, toh aapki operations team (PM/OM) ko khud woh data kisi Excel (CSV) file mein daal kar aapke system mein upload karna padta hai. 

---

### Project 51: ESoft Photo's
**`51,ESoft Photo's,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (51)**: System mein is project ka ID number 51 hai.
2. **Project Name (ESoft Photo's)**: 
   * **ESoft**: Yeh ek client, property company, ya third-party vendor ka naam hai.
   * **Photo's**: Iska matlab hai ke is project mein bhi sirf tasweeron (photos) ki editing ka kaam hota hai.
3. **Has Client API (No) & Source Script (-)**: Is ESoft client ka aapke system ke sath koi automatic connection ya API nahi lagi hui jo khud orders le aaye.
4. **Detailed Operation ("Standalone project...")**: Yeh bhi ek mukammal Manual Project hai. Jab ESoft ki taraf se koi naya tasweer edit karne ka kaam aata hai, toh aapki team ko woh kaam khud se (CSV file upload karke ya form fill karke) system mein enter karna padta hai, taake phir woh kaam kisi designer ko diya ja sake.

---

### Project 53: JH PHOTOS
**`53,JH PHOTOS,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (53)**: Is project ka ID number 53 hai.
2. **Project Name (JH PHOTOS)**: 
   * **JH**: Yeh kisi client ya agency ka naam hai jiska yeh kaam hai.
   * **PHOTOS**: Iska matlab is project mein bhi sirf Tasweerein (Photos) edit ki jati hain, nakshey (floor plans) nahi bante.
3. **Has Client API (No) & Source Script (-)**: Is project ka bhi koi automatic system nahi hai jo internet se khud orders le aaye.
4. **Detailed Operation ("Standalone project...")**: Yeh bhi baqi tasweeron wale projects ki tarah ek Manual Project hai. JH client ki taraf se aane wali tasweeron ke orders bhi aapki team ko khud CSV/Excel ke zariye upload karne padte hain, aur phir woh kaam aapke designers ko check aur edit karne ke liye milta hai.

---

### Project 54: Scan PHOTO
**`54,Scan PHOTO,No,-,"Standalone project. No automated external fetch."`**

1. **Project ID (54)**: System mein is project ka aakhri number ya ID 54 hai.
2. **Project Name (Scan PHOTO)**: 
   * **Scan**: Iska matlab yeh hai ke shayad is project mein client properties ke 3D scans ya scanned images bhejta hai.
   * **PHOTO**: Lekin kyunke iske aage "PHOTO" likha hai, toh iska matlab is project mein bhi sirf tasweeron (photos) ko process ya edit karne ka kaam hota hai. Yeh bhi aapke Designers ka hi kaam hai.
3. **Has Client API (No) & Source Script (-)**: Is project ka bhi koi automatic system nahi hai jo internet se khud orders le aaye.
4. **Detailed Operation ("Standalone project...")**: Yeh bhi ek mukammal Manual Project hai. Jab bhi "Scan PHOTO" ka koi naya order aata hai, toh aapki team ko woh kaam khud se (CSV file upload karke ya manually form fill karke) system mein enter karna padta hai. Uske baad yeh order kisi designer ko milta hai taake woh apna timer start karke is par kaam kar sake.

---

