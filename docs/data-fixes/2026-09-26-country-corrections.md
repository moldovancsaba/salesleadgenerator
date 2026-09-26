# Country corrections, 2026-09-26 (issues #222, #223)

Production data change. Each row is one lead whose stored `country` contradicted its own `address`, which names the country in full. Found by `GET /api/admin/data-hygiene/country` (2.4.231).

Each lead was fixed one at a time with `country` only:
1. A fresh `GET` confirmed the stored country was unchanged and the address still contained the evidence.
2. A `PUT` set `country` and appended a note; existing notes were kept first.
3. A fresh `GET` verified the new country and that `address`, `region`, `kanbanColumn` and the earlier notes were unchanged.

`region` was left as it was: it feeds the ticket-size region multipliers, so changing it is a business decision.

All 192 rows below are `fixed+verified`. After the run the check reports `mismatch: 0` for every brand.

Of Seyu's 189 fixes, 180 had been stored as `US`. That is a second default-value signature, wider than the `DE` cluster #222 was filed for.

| Brand | Lead id | Lead | Was | Now | Address evidence |
|---|---|---|---|---|---|
| cogmap | `6a5da7e851b8c302733fb766` | New Zealand Cricket | HU | NZ | New Zealand |
| cogmap | `6a604c8d907f2956fcf5f9c2` | New Zealand Cricket | HU | NZ | New Zealand |
| cogmap | `6a6744a8d1e151dfa27aa5d1` | AS Monaco Academy | FR | MC | Monaco |
| seyu | `6a57f751ec5bee09b71ea52a` | Saudi Arabian Football Federation | AE | SA | Saudi Arabia |
| seyu | `6a57f752ec5bee09b71ea52c` | Al Ahli Club Company | AE | SA | Saudi Arabia |
| seyu | `6a5a1c27d4a18e4fa27471ff` | Athletic Bilbao | DE | ES | Spain |
| seyu | `6a5e2f83771e42e3b88d2004` | CD Mirandés | US | ES | Spain |
| seyu | `6a5e642e0b7d20e206e9a83c` | DAZN | US | GB | United Kingdom |
| seyu | `6a5e6489d080b840f3e2314f` | World Athletics | US | MC | Monaco |
| seyu | `6a5e649dd080b840f3e23151` | FIFA | US | CH | Switzerland |
| seyu | `6a5e64b1d080b840f3e23153` | World Rugby | US | IE | Ireland |
| seyu | `6a5e64cdd080b840f3e23155` | FIBA | US | CH | Switzerland |
| seyu | `6a5e64dfd080b840f3e23157` | UCI | US | CH | Switzerland |
| seyu | `6a5e64f1d080b840f3e23159` | FIH | US | CH | Switzerland |
| seyu | `6a5e6504d080b840f3e2315b` | World Archery | US | CH | Switzerland |
| seyu | `6a5e652dd080b840f3e2315d` | World Aquatics | US | CH | Switzerland |
| seyu | `6a5e6542d080b840f3e2315f` | Badminton World Federation | US | MY | Malaysia |
| seyu | `6a5e6575d080b840f3e23163` | International Fencing Federation | US | CH | Switzerland |
| seyu | `6a5e658dd080b840f3e23165` | FEI | US | CH | Switzerland |
| seyu | `6a5e65a1d080b840f3e23167` | International Canoe Federation | US | CH | Switzerland |
| seyu | `6a5e65b3d080b840f3e23169` | Egyptian Fencing Federation | US | EG | Egypt |
| seyu | `6a5e65cbd080b840f3e2316b` | World Curling Federation | US | GB | UK |
| seyu | `6a5e65dfd080b840f3e2316d` | World Rowing | US | CH | Switzerland |
| seyu | `6a5e67e85401ee827bd05d6c` | Live Nation Entertainment | NO | US | United States |
| seyu | `6a5e72757fa49c8951308230` | Confederation of African Football | US | EG | Egypt |
| seyu | `6a5e72877fa49c8951308232` | African Handball Confederation | US | CI | Ivory Coast |
| seyu | `6a5e72ba7fa49c8951308238` | African Basketball Confederation | US | CI | Ivory Coast |
| seyu | `6a5e72de7fa49c895130823c` | South African Football Association | US | ZA | South Africa |
| seyu | `6a5e72f17fa49c895130823e` | Nigerian Football Federation | US | NG | Nigeria |
| seyu | `6a5e73047fa49c8951308240` | Football Kenya Federation | US | KE | Kenya |
| seyu | `6a5e73177fa49c8951308242` | Saudi Arabian Football Federation | US | SA | Saudi Arabia |
| seyu | `6a5e732a7fa49c8951308244` | UAE Football Association | US | AE | UAE |
| seyu | `6a5e733b7fa49c8951308246` | Qatar Football Association | US | QA | Qatar |
| seyu | `6a5e734e7fa49c8951308248` | Asian Football Confederation | US | MY | Malaysia |
| seyu | `6a5e73587fa49c895130824a` | Asian Handball Federation | US | KW | Kuwait |
| seyu | `6a5e73627fa49c895130824c` | Asian Volleyball Confederation | US | TH | Thailand |
| seyu | `6a5e73777fa49c895130824e` | Saudi Handball Federation | US | SA | Saudi Arabia |
| seyu | `6a5e73887fa49c8951308250` | UAE Handball Federation | US | AE | UAE |
| seyu | `6a5e73987fa49c8951308252` | Saudi Basketball Federation | US | SA | Saudi Arabia |
| seyu | `6a5e73e27fa49c895130825a` | Hungarian Handball Federation | US | HU | Hungary |
| seyu | `6a5e74167fa49c8951308260` | Romanian Handball Federation | US | RO | Romania |
| seyu | `6a5e74347fa49c8951308264` | French Handball Federation | US | FR | France |
| seyu | `6a5e74447fa49c8951308266` | Spanish Handball Federation | US | ES | Spain |
| seyu | `6a5e74587fa49c8951308268` | Hungarian Football Federation | US | HU | Hungary |
| seyu | `6a5e747c7fa49c895130826c` | Czech Football Federation | US | CZ | Czech Republic |
| seyu | `6a5e74c07fa49c8951308274` | Slovenian Football Federation | US | SI | Slovenia |
| seyu | `6a5e74fd7fa49c895130827e` | Azerbaijan Football Federation | US | AZ | Azerbaijan |
| seyu | `6a5e75107fa49c8951308280` | Lithuanian Football Federation | US | LT | Lithuania |
| seyu | `6a5e75197fa49c8951308282` | Latvian Football Federation | US | LV | Latvia |
| seyu | `6a5e75507fa49c8951308288` | Football Federation of Belarus | US | BY | Belarus |
| seyu | `6a5e756b7fa49c895130828c` | Football Federation of North Macedonia | US | MK | North Macedonia |
| seyu | `6a5e758d7fa49c8951308298` | Albanian Football Association | US | AL | Albania |
| seyu | `6a5e75b27fa49c895130829e` | Serbian Basketball Federation | US | RS | Serbia |
| seyu | `6a5e75bc7fa49c89513082a0` | Czech Basketball Federation | US | CZ | Czech Republic |
| seyu | `6a5e75c67fa49c89513082a2` | Latvian Basketball Association | US | LV | Latvia |
| seyu | `6a5e75d17fa49c89513082a4` | Estonian Basketball Association | US | EE | Estonia |
| seyu | `6a5e75e17fa49c89513082a6` | Al Hilal | US | SA | Saudi Arabia |
| seyu | `6a5e75ed7fa49c89513082a8` | Al Nassr | US | SA | Saudi Arabia |
| seyu | `6a5e76157fa49c89513082b0` | Esteghlal | US | IR | Iran |
| seyu | `6a5e762f7fa49c89513082b4` | Al Duhail | US | QA | Qatar |
| seyu | `6a5e764d7fa49c89513082b6` | Jeonbuk Hyundai Motors | US | KR | South Korea |
| seyu | `6a5e76687fa49c89513082ba` | Yokohama F. Marinos | US | JP | Japan |
| seyu | `6a5e76737fa49c89513082bc` | Kawasaki Frontale | US | JP | Japan |
| seyu | `6a5e76907fa49c89513082c0` | Kashima Antlers | US | JP | Japan |
| seyu | `6a5e76b77fa49c89513082c4` | Sydney FC | US | AU | Australia |
| seyu | `6a5e76ee7fa49c89513082cc` | Johor Darul Ta'zim | US | MY | Malaysia |
| seyu | `6a5e76f87fa49c89513082ce` | Mumbai City FC | US | IN | India |
| seyu | `6a5e77037fa49c89513082d0` | ATK Mohun Bagan | US | IN | India |
| seyu | `6a5e955cca2ec7920a835744` | Istanbul Basaksehir | US | TR | Turkey |
| seyu | `6a5e9626ca2ec7920a8357c4` | Galatasaray | US | TR | Turkey |
| seyu | `6a5e967aca2ec7920a8357d4` | Sky Sports | US | GB | United Kingdom |
| seyu | `6a5e9696ca2ec7920a8357d8` | UEFA Champions League | US | CH | Switzerland |
| seyu | `6a5ea7da0c36f03715a04be6` | Olympic Games | US | CH | Switzerland |
| seyu | `6a5ea81074546378d6e545f1` | ICC T20 World Cup | IN | AE | United Arab Emirates |
| seyu | `6a5ea81a74546378d6e545f3` | Six Nations | IE | GB | United Kingdom |
| seyu | `6a5ec2309b1f4f49dd37ca45` | Real Madrid | US | ES | Spain |
| seyu | `6a5f1b3361623359369775d8` | World Athletics | US | CH | Switzerland |
| seyu | `6a5f1b3461623359369775da` | World Rugby | US | GB | United Kingdom |
| seyu | `6a5f1b3561623359369775dc` | Real Madrid | US | ES | Spain |
| seyu | `6a5f1b3561623359369775de` | FC Bayern Munich | US | DE | Germany |
| seyu | `6a5f1b3661623359369775e0` | Manchester City | US | GB | United Kingdom |
| seyu | `6a5f1b4861623359369775e2` | FC Barcelona | US | ES | Spain |
| seyu | `6a5f1b4861623359369775e4` | Chelsea FC | US | GB | United Kingdom |
| seyu | `6a5f1b4961623359369775e6` | Arsenal FC | US | GB | United Kingdom |
| seyu | `6a5f1b4961623359369775e8` | Paris Saint-Germain | US | FR | France |
| seyu | `6a5f1b4a61623359369775ea` | Juventus FC | US | IT | Italy |
| seyu | `6a5f1b6261623359369775ec` | AC Milan | US | IT | Italy |
| seyu | `6a5f1b6261623359369775ee` | Inter Milan | US | IT | Italy |
| seyu | `6a5f1b6361623359369775f0` | SL Benfica | US | PT | Portugal |
| seyu | `6a5f1b6361623359369775f2` | FC Porto | US | PT | Portugal |
| seyu | `6a5f1b6461623359369775f4` | Sporting CP | US | PT | Portugal |
| seyu | `6a5f1b7761623359369775f6` | AFC Ajax | US | NL | Netherlands |
| seyu | `6a5f1b7861623359369775f8` | PSV Eindhoven | US | NL | Netherlands |
| seyu | `6a5f1b7861623359369775fa` | Celtic FC | US | GB | United Kingdom |
| seyu | `6a5f1b7961623359369775fc` | Rangers FC | US | GB | United Kingdom |
| seyu | `6a5f1b7a61623359369775fe` | FC Red Bull Salzburg | US | AT | Austria |
| seyu | `6a5f1b8e6162335936977600` | Club Brugge | US | BE | Belgium |
| seyu | `6a5f1b8e6162335936977602` | Shakhtar Donetsk | US | UA | Ukraine |
| seyu | `6a5f1b8f6162335936977604` | Olympiacos FC | US | GR | Greece |
| seyu | `6a5f1b8f6162335936977606` | FC Copenhagen | US | DK | Denmark |
| seyu | `6a5f1b906162335936977608` | AEK Athens | US | GR | Greece |
| seyu | `6a5f1ba9616233593697760a` | Fenerbahçe | US | TR | Turkey |
| seyu | `6a5f1baa616233593697760c` | Galatasaray | US | TR | Turkey |
| seyu | `6a5f1baa616233593697760e` | Red Star Belgrade | US | RS | Serbia |
| seyu | `6a5f1bab6162335936977610` | Partizan Belgrade | US | RS | Serbia |
| seyu | `6a5f1bac6162335936977612` | SK Slavia Prague | US | CZ | Czech Republic |
| seyu | `6a5f1bbf6162335936977614` | AC Sparta Prague | US | CZ | Czech Republic |
| seyu | `6a5f1bc06162335936977616` | Ferencváros | US | HU | Hungary |
| seyu | `6a5f1bc06162335936977618` | Ludogorets | US | BG | Bulgaria |
| seyu | `6a5f1bc1616233593697761a` | GNK Dinamo Zagreb | US | HR | Croatia |
| seyu | `6a5f1bc2616233593697761c` | Legia Warsaw | US | PL | Poland |
| seyu | `6a5f1bd7616233593697761e` | Lech Poznań | US | PL | Poland |
| seyu | `6a5f1bd86162335936977620` | Rosenborg BK | US | NO | Norway |
| seyu | `6a5f1bd86162335936977622` | Malmö FF | US | SE | Sweden |
| seyu | `6a5f1bd96162335936977624` | FC Basel | US | CH | Switzerland |
| seyu | `6a5f1bd96162335936977626` | BSC Young Boys | US | CH | Switzerland |
| seyu | `6a5f1bef616233593697762a` | Paris Saint-Germain Handball | US | FR | France |
| seyu | `6a5f1bf0616233593697762c` | THW Kiel | US | DE | Germany |
| seyu | `6a5f1bf0616233593697762e` | SC Magdeburg | US | DE | Germany |
| seyu | `6a5f1bf16162335936977630` | Telekom Veszprém | US | HU | Hungary |
| seyu | `6a5f1c086162335936977632` | Al Hilal | US | SA | Saudi Arabia |
| seyu | `6a5f1c096162335936977634` | Al Nassr | US | SA | Saudi Arabia |
| seyu | `6a5f1c096162335936977636` | Al Ittihad | US | SA | Saudi Arabia |
| seyu | `6a5f1c0a6162335936977638` | Al Ahli Saudi | US | SA | Saudi Arabia |
| seyu | `6a5f1c0b616233593697763a` | Persepolis | US | IR | Iran |
| seyu | `6a5f1c24616233593697763c` | Esteghlal | US | IR | Iran |
| seyu | `6a5f1c24616233593697763e` | Al Sadd | US | QA | Qatar |
| seyu | `6a5f1c256162335936977640` | Al Duhail | US | QA | Qatar |
| seyu | `6a5f1c266162335936977642` | Jeonbuk Hyundai Motors | US | KR | South Korea |
| seyu | `6a5f1c266162335936977644` | FC Seoul | US | KR | South Korea |
| seyu | `6a5f1c376162335936977646` | Yokohama F. Marinos | US | JP | Japan |
| seyu | `6a5f1c386162335936977648` | Kawasaki Frontale | US | JP | Japan |
| seyu | `6a5f1c38616233593697764a` | Urawa Red Diamonds | US | JP | Japan |
| seyu | `6a5f1c39616233593697764c` | Kashima Antlers | US | JP | Japan |
| seyu | `6a5f1c39616233593697764e` | Melbourne Victory | US | AU | Australia |
| seyu | `6a5f1c4b6162335936977650` | Sydney FC | US | AU | Australia |
| seyu | `6a5f1c4c6162335936977652` | Guangzhou FC | US | CN | China |
| seyu | `6a5f1c4c6162335936977654` | Shandong Taishan | US | CN | China |
| seyu | `6a5f1c4d6162335936977656` | Bangkok United | US | TH | Thailand |
| seyu | `6a5f1c4e6162335936977658` | Johor Darul Ta'zim | US | MY | Malaysia |
| seyu | `6a5f1c5d616233593697765a` | Mumbai City FC | US | IN | India |
| seyu | `6a5f1c5e616233593697765c` | ATK Mohun Bagan | US | IN | India |
| seyu | `6a5f1c5f616233593697765e` | Mumbai Indians | US | IN | India |
| seyu | `6a5f1c5f6162335936977660` | Chennai Super Kings | US | IN | India |
| seyu | `6a5f1c606162335936977662` | Kolkata Knight Riders | US | IN | India |
| seyu | `6a5f1c726162335936977664` | Royal Challengers Bangalore | US | IN | India |
| seyu | `6a5f1c726162335936977666` | Delhi Capitals | US | IN | India |
| seyu | `6a5f1c736162335936977668` | Punjab Kings | US | IN | India |
| seyu | `6a5f1c73616233593697766a` | Rajasthan Royals | US | IN | India |
| seyu | `6a5f1c74616233593697766c` | Gujarat Titans | US | IN | India |
| seyu | `6a5f1c86616233593697766e` | Lahore Qalandars | US | PK | Pakistan |
| seyu | `6a5f1c876162335936977670` | Islamabad United | US | PK | Pakistan |
| seyu | `6a5f1c876162335936977672` | Peshawar Zalmi | US | PK | Pakistan |
| seyu | `6a5f1c886162335936977674` | Dubai Capitals | US | AE | United Arab Emirates |
| seyu | `6a5f1c896162335936977676` | Gulf Giants | US | AE | United Arab Emirates |
| seyu | `6a5f1ca16162335936977678` | Yomiuri Giants | US | JP | Japan |
| seyu | `6a5f1ca1616233593697767a` | Hanshin Tigers | US | JP | Japan |
| seyu | `6a5f1ca2616233593697767c` | Fukuoka SoftBank Hawks | US | JP | Japan |
| seyu | `6a5f1ca3616233593697767e` | Samsung Lions | US | KR | South Korea |
| seyu | `6a5f1ca36162335936977680` | Doosan Bears | US | KR | South Korea |
| seyu | `6a5f1cb76162335936977682` | Perth Scorchers | US | AU | Australia |
| seyu | `6a5f1cb86162335936977684` | Melbourne Stars | US | AU | Australia |
| seyu | `6a5f1cb96162335936977686` | Sydney Sixers | US | AU | Australia |
| seyu | `6a5f1ce6616233593697769c` | Laola1 | US | AT | Austria |
| seyu | `6a5f1ce7616233593697769e` | Opta | US | GB | United Kingdom |
| seyu | `6a5f1d0261623359369776a0` | Tencent Sports | US | CN | China |
| seyu | `6a5f1d0261623359369776a2` | iQIYI Sports | US | CN | China |
| seyu | `6a5f1d0361623359369776a4` | Sony Sports | US | IN | India |
| seyu | `6a5f1d0461623359369776a6` | Star Sports | US | IN | India |
| seyu | `6a5f1d1861623359369776ac` | BT Sport | US | GB | United Kingdom |
| seyu | `6a5f1d1961623359369776ae` | beIN Sports | US | QA | Qatar |
| seyu | `6a5f1d1a61623359369776b0` | Canal+ | US | FR | France |
| seyu | `6a5f1d1a61623359369776b2` | RMC Sport | US | FR | France |
| seyu | `6a5f7710a16e95eac31ef301` | FC Bayern Munich | US | DE | Germany |
| seyu | `6a5f7712a16e95eac31ef305` | SL Benfica | US | PT | Portugal |
| seyu | `6a5f7712a16e95eac31ef307` | FC Porto | US | PT | Portugal |
| seyu | `6a5f7713a16e95eac31ef309` | Sporting CP | US | PT | Portugal |
| seyu | `6a5f7713a16e95eac31ef30b` | AFC Ajax | US | NL | Netherlands |
| seyu | `6a5f7714a16e95eac31ef30d` | Celtic FC | US | GB | Scotland |
| seyu | `6a5f7715a16e95eac31ef30f` | Rangers FC | US | GB | Scotland |
| seyu | `6a5f779ea16e95eac31ef34f` | Sportradar | US | CH | Switzerland |
| seyu | `6a5f77d7a16e95eac31ef365` | Star Sports | US | IN | India |
| seyu | `6a5f7853c601a67679704739` | Olympiacos FC | US | GR | Greece |
| seyu | `6a5f78d9c601a6767970476d` | Vardar Handball | US | MK | North Macedonia |
| seyu | `6a5feddd2b3d0f5cc6219ecb` | IMG Events | US | AE | United Arab Emirates |
| seyu | `6a5fedde2b3d0f5cc6219ecd` | Octagon | US | GB | United Kingdom |
| seyu | `6a5feddf2b3d0f5cc6219ecf` | Lagardère Sports | US | FR | France |
| seyu | `6a602cad8ca4601f4ebc7696` | Formula 1 | DE | GB | United Kingdom |
| seyu | `6a62aedc6f734b3b97513a46` | Cortex Sports | DE | GB | UK |
| seyu | `6a62edc618edb7e1050003ba` | Euro Hockey League | US | NL | Netherlands |
| seyu | `6a63030ecb085977ed76222a` | MAZ Staging | DE | NL | Netherlands |
| seyu | `6a682ca9febef7e0d4f3ae5c` | Global Esports Federation | US | SG | Singapore |

## Invalid country codes (issue #223)

30 leads stored a `country` that is not an ISO code. Each code was the first two letters of the free-text `region`: `CEE`→`CE`, `Spain`/`SPAIN`→`SP`, `EMEA`→`EM`/`EU`. They were fixed with the same one-lead-at-a-time procedure as above.

The evidence is the lead's own address, with 4 exceptions:
- 3 leads have no address, but their own names contain their city (Sparta Praha, Legia Warsaw, CSKA Sofia).
- Infront Sports & Media's headquarters was confirmed from its own contact page (infront.sport/contact: Grafenauweg 2, 6302 Zug, Switzerland).

After the run the check reports `invalid-code: 0` for every brand.

Two records to review separately:
- Seyu lead `Verify Real Madrid` is named like a to-do item, not an organisation.
- Real Madrid Baloncesto's address contains a stray non-Latin character (`Avenida de las绮`).

| Brand | Lead id | Lead | Was | Now | Evidence |
|---|---|---|---|---|---|
| seyu | `6a57f752ec5bee09b71ea52e` | KS Cracovia SA | CE | PL | the lead's own address names "Poland" |
| seyu | `6a57f752ec5bee09b71ea530` | SK Slavia Praha | CE | CZ | the lead's own address names "Czech Republic" |
| seyu | `6a57f753ec5bee09b71ea532` | HNK Hajduk Split | CE | HR | the lead's own address names "Croatia" |
| seyu | `6a57f760ec5bee09b71ea56e` | Red Star Belgrade (Crvena zvezda) | CE | RS | the lead's own address names "Serbia" |
| seyu | `6a5800d0c32aacfacd04eeee` | AC Sparta Praha | CE | CZ | the lead name names Praha (Prague) |
| seyu | `6a5800d1c32aacfacd04eef2` | Legia Warsaw Academy | CE | PL | the lead name names Warsaw |
| seyu | `6a5800d3c32aacfacd04eef8` | CSKA Sofia Academy | CE | BG | the lead name names Sofia |
| seyu | `6a58281725ec8c91af9b33ea` | CD Leganés | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58281725ec8c91af9b33ec` | Granada CF | SP | ES | the lead's own address names "Spain" |
| seyu | `6a583d9a2de94f978074fdf3` | RCD Espanyol | SP | ES | the lead's own address names "Spain" |
| seyu | `6a585345e246f59b514b01f9` | Club Atlético de Madrid | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58726f8a72b619ae4eb91e` | Atlético de Madrid | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58732c8a72b619ae4eb920` | Villarreal CF | SP | ES | the lead's own address names "Spain" |
| seyu | `6a587d549821316ebfd38f66` | Real Zaragoza | SP | ES | the lead's own address names "Spain" |
| seyu | `6a589c284a93769cb782aff8` | Real Betis Balompié | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58ac529689d4dc7e733c4c` | Real Betis Baloncesto | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58ac5c9689d4dc7e733c4e` | Deportivo Alavés | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58add0f20f09610a99125f` | Sevilla FC | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58c2e4c5c92bff93e54e93` | RC Celta de Vigo | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58c3973869171d5c2245a9` | Real Sociedad de Fútbol | SP | ES | the lead's own address names "Spain" |
| cogmap | `6a6063fd5634a8768d6f670b` | Huddersfield Town AFC | EU | GB | the lead's own address names "England" |
| seyu | `6a58c70f5d03eb4d060f7d6b` | Girona FC | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58c70f756e44a5e8ca6aeb` | Athletic Club Bilbao | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58c7fa756e44a5e8ca6aed` | UD Las Palmas | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58c940756e44a5e8ca6aef` | Real Sociedad | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58dbc4342dc3346d04bcd6` | Real Madrid Baloncesto | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58dbe6342dc3346d04bcd8` | Verify Real Madrid | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58e9989b6d14a45345b3b9` | Getafe CF | SP | ES | the lead's own address names "Spain" |
| seyu | `6a58e9999b6d14a45345b3bb` | RCD Mallorca | SP | ES | the lead's own address names "Spain" |
| seyu | `6a6337d762c63b1c3426e389` | Infront Sports & Media | EM | CH | Infront's own contact page (infront.sport/contact) gives its headquarters as Grafenauweg 2, 6302 Zug, Switzerland |
