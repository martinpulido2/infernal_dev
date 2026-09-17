// narrative/narrativeContent.js
//
// The 9-screen content manifest from the intro-sequence TRD, as plain
// data — kept separate from introSequence.js's playback machinery so a
// future copy/asset pass doesn't require touching any logic. Paragraphs
// 3 and 5 of the finalized (25%-cut) origin text are each split across
// two screens to match a discrete visual beat in the art, per the TRD's
// content manifest table; every other paragraph is 1:1 with a screen.
//
// image paths are web-root-relative, matching how every other module in
// this project references /public assets (see charData in
// orientation/select.js).

export const NARRATIVE_SCREENS = [
  {
    image: '/public/narrative/1-Clockwork.jpg',
    text: "Before time had a name, Elyon forged the angels: His most luminous creations, crowned as stewards of the nascent cosmos. Yet for all their brilliance, they were untried—flawless clockwork, keeping perfect time with righteousness, blind to its beating heart.",
  },
  {
    image: '/public/narrative/2-StygianVeil.jpg',
    text: "To grant them authentic holiness, Elyon decreed The Great Descent: the angels would pass through the Stygian Veil into fragile mortal flesh, their divine memories erased, to be forged in fear, pain, and free agency. Those who chose virtue would rise as archangels; those who faltered would fall forever. Elyon said nothing more—not then, and not since.",
  },
  {
    // First half of the war paragraph — compromise, panic, the three-way
    // split, and the Ignavi named. The Fall itself is held for the next
    // screen so it can land on its own image.
    image: '/public/narrative/3-4-War.jpg',
    text: "Paralyzed by the terror of absolute risk, Abaddon and Marek proposed mandatory repentance: a safety net guaranteeing no spirit could ever be lost. Elyon's silence was answer enough, and panic erupted into war. The faithful held the heights; the rebels fought for preservation; and a third host, unable to bear the choice at all, simply refused to make one. Both sides despised them for it. History named them the Ignavi—spared damnation only because they'd committed to nothing.",
  },
  {
    image: '/public/narrative/5-Cataclysmic_Descent.jpg',
    text: "Cast out alongside the rebels, their fall tore open the abyssal vaults of Hell.",
  },
  {
    image: '/public/narrative/6-ElmFalseDreams2.jpg',
    text: "Once their brethren were born as mortals, the fallen set out to prove Elyon's experiment a tragedy—luring humanity from Eden and grafting a wicked sapling onto its severed roots: the Elm of False Dreams, which broadcast despair and distorted desire across the mortal realm, and taught devils the art of possession. The Ignavi took no side in this either, drifting through the abyss for eons, growing only more hollow.",
  },
  {
    // First half of Marek's heresy paragraph — setup only. The strike
    // itself is held for the next screen/image (see TRD §3 note).
    image: '/public/narrative/7-Marek.jpg',
    text: "For eons Marek wrought misery beside Abaddon, certain that enough suffering would force Elyon to relent.",
  },
  {
    image: '/public/narrative/8-SacrificalStrike.jpg',
    text: "Everything shattered the day he inhabited a dying youth shielding a stranger with her own body—no reward waiting, no bargain struck. That unshielded strike of love tore through his demonic heart and birthed a heresy: if Earth is a forge for moral evolution, were the fallen cast down not to tempt, but to grow?",
  },
  {
    image: '/public/narrative/9-Ignavi.jpg',
    text: "Branded a traitor and exiled for preaching it, Marek spent a millennium in the mortal world, weaving quiet light into human history and art. It was not enough; the torment endured. In his despair he turned at last to the Ignavi—the ones he'd once scorned as spineless—not to lead them, but to listen. What he found were not cowards, but souls each carrying a private reason for their paralysis. In the telling, something in them loosened.",
  },
  {
    image: '/public/narrative/10-YawningFissure.jpg',
    text: "No longer alone, Marek returns to the gates of Hell to ignite an impossible revolution: to burn the Elm of False Dreams, shatter the stagnant order of the abyss, and offer every soul brave enough one last, true choice.",
  },
];
