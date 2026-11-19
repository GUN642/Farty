# Farty – Das Pups-Floß

Ein privates Partyspiel: Bis zu vier Tiere sitzen auf einem runden Schlauchboot und treiben einen wilden Fluss
hinunter. Angetrieben wird nur mit **Pupskraft** – wer pupst, schiebt das Boot in seine Blickrichtung. Weil alle an
verschiedenen Stellen des Bootsrands sitzen, dreht es sich beim falschen Pups sofort im Kreis. Nur gemeinsam kommt
ihr an Felsen, Kakteen, Strudeln und Drehbalken vorbei ins Ziel.

Läuft im Browser (GitHub Pages) und als Android-App (auch auf Android TV, mit automatischer Update-Funktion).
Steuerung per Nintendo-Switch-Controller (Pro Controller oder Joy-Cons), anderen Gamepads, Tastatur oder Touchscreen.

**Spielen:** https://gun642.github.io/Farty/
**Android-APK:** https://gun642.github.io/Farty/apk/farty.apk

## Spielablauf

- Jeder Spieler steuert ein Tier. **Stick** = Richtung, in die das Tier schaut (bezogen auf den Bildschirm),
  **Taste halten** = pupsen. Der Pups geht nach hinten raus, das Boot wird nach vorne geschoben.
- Die kleine Leiste unter dem Namen ist das **Pupsgas**. Es füllt sich in Pausen wieder auf.
- **Bohnendosen** füllen das Gas des nächsten Tiers auf und geben 3 s **Turbo-Pups**.
- **Goldene Bohnen** (3 pro Fluss) und **Luftpumpen** (flicken das Boot).
- Stacheln, Kakteen, Eiszapfen und Stachelbojen lassen **Luft** raus. Bei 0 % – **PENG!** – geht es am letzten
  Kontrollpunkt weiter.
- **Sterne:** ★ ins Ziel gekommen, ★ alle goldenen Bohnen, ★ schneller als die Vorgabezeit.

### Flüsse

| Fluss | Besonderheit |
| --- | --- |
| Plätscherbach | Waldbach zum Eingewöhnen: Felsen, Baumstämme, ein paar Dornenhecken |
| Kaktusschlucht | Enge Wüstenschlucht mit Kaktus-Ufern, Stachelbojen und Stromschnellen |
| Blubbersumpf | Kaum Strömung (kräftig pupsen!), Strudel, Baumstämme, Seerosen |
| Wildwasser | Reißende Stromschnellen, Felsen, Drehbalken |
| Gletscherkanal | Eisschollen, Eiszapfen-Ufer, Strudel, Drehbalken |
| Zufallsfluss | jedes Mal eine neue Strecke mit allen Hindernissen |

## Steuerung

| | ein Tier | allein (zwei Tiere) |
| --- | --- | --- |
| Controller | Stick lenken, beliebige Taste (A/B/X/Y, L/R, ZL/ZR) pupsen | linker Stick + L/ZL → linkes Tier ◀, rechter Stick + R/ZR/A → rechtes Tier ▶ |
| Tastatur | WASD oder Pfeile, Leertaste pupsen | WASD + Leertaste ◀, Pfeile + Enter/Shift rechts ▶ |
| Touch | linker Daumen lenkt, PUPS!-Knopf | zwei Daumen-Sticks, weit drücken = pupsen |

Menü: Steuerkreuz/Stick + A oder B bestätigen, − zurück, + Pause. Am Android TV funktioniert alles mit dem
Controller (wie beim medevac-sim); die Zurück-Taste des Controllers beendet das Spiel nicht.

**Mehrere Controller an einem Gerät:** In der Lobby an jedem weiteren Controller eine Taste drücken – er spielt
als eigener Spieler mit (− zum Austreten). Ein einzelner Joy-Con quer gehalten reicht auch.

Spielt man allein, steuert man zwei Tiere (links und rechts). Ab zwei Spielern hat jeder ein Tier, bis zu vier pro Boot;
weitere Spieler schauen zu.

## Mehrspieler

Wie beim medevac-sim:

- **Online / WLAN → Spiel eröffnen.** Der Host bekommt einen **Spielcode** (z. B. `K7RQ2`) und einen Einladungslink.
  Mitspieler geben den Code unter *Online / WLAN* ein – im Browser oder in der App. Verbindung per WebRTC
  (PeerJS-Vermittlungsserver, danach direkt zwischen den Geräten).
- In der **Android-App** werden Spiele im selben WLAN automatisch gefunden (UDP-Broadcast, TCP-Verbindung), auch ohne
  Internet.
- Lokales Spiel und Online lassen sich mischen: z. B. zwei Controller am Fernseher + ein Freund am Handy.
- Der Host berechnet das Boot, die anderen schicken nur ihre Steuerung. Der Host wählt Fluss und Schwierigkeit.
- Test im Browser ohne Netz: zwei Tabs mit `?net=test` öffnen.

## Technik

- `web/` – das Spiel (three.js, reines JavaScript ohne Build-Schritt)
  - `river.js` Leveldaten und Streckengenerator (deterministisch, alle Geräte erzeugen dieselbe Strecke)
  - `sim.js` Bootsphysik und Spielregeln (läuft beim Host)
  - `world.js`, `raft.js`, `critters.js`, `fx.js` Darstellung
  - `input.js` Tastatur, Touch, Gamepads (inkl. Kalibrierung für Switch-Controller an Android)
  - `transport.js` Netzwerk (LAN in der App, PeerJS/WebRTC, Test-Kanal), `main.js` Ablauf, Menüs, Lobby, Protokoll
  - `audio.js` alle Klänge synthetisch (Web Audio), inkl. Pups-Synthesizer
- `android/` – WebView-Hülle (`MainActivity`), LAN-Mehrspieler (`LanNet`), Selbst-Update (`UpdateManager`)
- `.github/workflows/build-deploy.yml` – baut bei jedem Push die APK; auf dem Standardbranch wird sie signiert und
  zusammen mit der Web-App auf GitHub Pages veröffentlicht.

### Einmalige Einrichtung auf GitHub

1. **Settings → Pages → Build and deployment → Source: „GitHub Actions“** auswählen.
   (GitHub Pages für private Repositories braucht ein kostenpflichtiges Konto – sonst das Repository öffentlich machen.)
2. Danach den Workflow *Build & Deploy* erneut starten (Actions → Build & Deploy → Run workflow) oder etwas pushen.
3. Optional: eigener Signaturschlüssel statt des Startschlüssels – siehe `android/keystore/README.md`.

Die App prüft beim Start `version.json` auf GitHub Pages und bietet neue Versionen direkt zum Installieren an.

### Lokal starten

```
cd web && python3 -m http.server 8000
```
und http://localhost:8000 öffnen.
