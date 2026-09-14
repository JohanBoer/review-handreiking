# Voorstel merge request: reviewopmerkingen Handreiking betrouwbare registers

Bron: `annotations.json` (lokale review-tool). Dit is een **overzicht** van de
opmerkingen, gegroepeerd per pagina — geen inhoudelijke tekstwijzigingen.
Ter beoordeling voordat de MR daadwerkelijk wordt aangemaakt op
gitlab.com/digilab.overheid.nl/research/uit-betrouwbare-bron/documentatie.

## /voorbeelden

- Geciteerd: "...ssen bij de hand..." → **tEST QQWE**
  _(lijkt een test-opmerking, mogelijk niet bedoeld voor de MR)_

## /handreiking

- Geciteerd: "voorbeeld" → **voorbeelden**
- Geciteerd: "dient" → **dienen**
- Geciteerd: "Introduceert" → **Introductie van**

## /handreiking/aanleiding-en-doel

- Geciteerd: "...menselijke tussenkomst**.**" → **. Dit noemen we de happy flow.**
- Geciteerd: "minder vaak voorkomend" → Eventueel vervangen door "niet vooraf bedacht"
- Geciteerd: "Waardoor in die domeinen op basis van verkeerde gegevens onjuiste
  gevolgen geproduceerd kunnen worden." → Deze zin loopt niet lekker. Het voelt
  alsof deze nog onderdeel is van de vorige zin door het gebruik van "waardoor"
- Geciteerd: "Het bovenstaande maakt duidelijk dat overheidsinformatie niet
  altijd klopt. En dit soort onjuistheden zullen altijd overblijven, hoeveel
  crappy flows we ook in happy flows weten om te zetten." → Gevoelsmatig zou
  dit één zin moeten zijn. Anders zou ik de 2e zin niet beginnen met "En"
- Geciteerd: "gebeurd. En dat we geen compleet beeld hebben van hoe lang óns
  handelen verderop in de keten nog doorwerkt." → Ook hier denk ik dat dit één
  zin zou moeten zijn.
- Geciteerd: "hoe zag de situatie er in het verleden uit" → Zou dit niet moeten
  zijn "welke (geautomatiseerde) handelingen hebben we in het verleden
  uitgevoerd en welke gevolgen zijn er als gevolg daarvan geproduceerd?"
- Geciteerd: "Waar het misging werden daardoor niet alleen meer burgers en
  bedrijven getroffen. Doordat gegevens geautomatiseerd door ketens stroomden,
  konden op basis daarvan meerdere organisaties handelen. Fouten hadden
  daardoor voor betrokkenen ook verstrekkender gevolgen." → Dit staat in de
  verleden tijd beschreven (wat natuurlijk klopt) maar daardoor zou de indruk
  kunnen ontstaan dat deze situatie al achter ons ligt. Dat is niet zo, het
  gaat nog steeds mis.
- Geciteerd: "geval herstellen." → geval kunnen herstellen (uit oude review)
- Geciteerd: "afgehandeld." → afgehandeld omdat die niet is voorzien bij het
  inrichten van processen en bijbehorende geautomatiseerde ondersteuning.
  (Oude review)

## /handreiking/definitie-en-scope

- Geciteerd: "Een applicatiecomponent, of een verzameling samenwerkende
  applicatiecomponenten," → Met het inzicht van nu kunnen we gerust stellen
  dat het om een de verzameling samenwerkende applicatiecomponenten gaat. Dus
  "Een applicatiecomponent" kan weg lijkt mij.
- Geciteerd: "samenwerkt," → samengewerkt
- Geciteerd: "binnen" → Alleen binnen domeinen of ook tussen domeinen?
- Geciteerd: "en vanwege de relatie tussen bijhoudingsdiensten en processen
  die deze gebruiken ook een deel van" → en, vanwege de relatie tussen
  bijhoudingsdiensten en processen die deze gebruiken, ook een deel van
  (komma's om de bijzin heen?)
- Geciteerd: "hieronder bespreken we" → hieronder verwijderen. In deze
  vormgeving is het een andere pagina. (Dan ook "we bespreken")
- Geciteerd: "...basisregistratie bestaat**.**" → Alternatief voor laatste
  zin: verwachten we dat in deze handreiking beschreven bevindingen in eerste
  instantie waardevol zullen zijn binnen domeinen waarbinnen op basis van
  gedeelde kennis intensief wordt samengewerkt, maar waar (delen van) die
  kennis niet zijn vastgelegd in een basisregistratie. Toelichting: als er in
  een domein wel een basisregistratie bestaat zou dat toch geen belemmering
  moeten zijn om onze bevindingen toe te passen?

## /handreiking/grenzen

- Geciteerd: "Hierbij moeten taal en model van de ene context omgezet worden
  naar taal en model van de andere." → Hier kan je verwijzen naar de laatste
  regel van het citaat van Eric Evans
- Geciteerd: "'eigen' context volgen, worden dan óók verstrekkingen gemaakt
  die aansluiten bij de conventies van bounded contexten van afnemers. Taak en
  gevolg hebben wel een vast bounded context en conformeren zich altijd aan de
  taal en het model van de bounded context" → Opmerking
- Geciteerd: "Taak en" → Taak (het produceren van een gevolg) en

## /handreiking/uitvoeringscontext

- Geciteerd: "Vertrekt" → Vertrekpunt?
