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
    text: "Before time had a name, Elyon forged the angels: His most luminous creations, crowned as stewards of the nascent cosmos. Yet for all their brilliance, they were untried. Like flawless clockwork, they ticked with righteousness, but they were blind to its beating heart.",
  },
  {
    image: '/public/narrative/2-StygianVeil.jpg',
    text: "To grant them authentic holiness, Elyon decreed The Great Descent: the angels would pass through the Stygian Veil into fragile mortal flesh, their divine memories erased, to be forged in fear, pain, and the burden of choice. Those who chose virtue would rise as archangels; those who faltered could not return to Elyon's presence. Elyon said nothing more—not then, and not since.",
  },
  {
    // First half of the war paragraph — compromise, panic, the three-way
    // split, and the Ignavi named. The Fall itself is held for the next
    // screen so it can land on its own image.
    image: '/public/narrative/3-4-War.jpg',
    text: "This caused no small stir among the angels. Paralyzed by the terror of risk, Abaddon and Marek proposed an amendment to Elyon's plan: Mandatory repentance, a safety net guaranteeing no spirit could ever be fully lost. When Elyon did not respond, panic erupted into war. The faithful held to Elyon's plan; the rebels fought for preservation; and a third host, unable to bear the choice at all, simply refused to make one. The other sides despised them for it. History named them the Ignavi, spared damnation only because they'd committed to nothing.",
  },
  {
    image: '/public/narrative/5-Cataclysmic_Descent.jpg',
    text: "Cast out alongside the rebels, their fall and impact on hitting the Earth broke upon open the abyssal vaults of Hell.",
  },
  {
    image: '/public/narrative/6-ElmFalseDreams2.jpg',
    text: "Once their brethren were born as mortals, the fallen set out to prove Elyon's experiment a tragedy. Luring humanity from Eden and grafting a wicked sapling from the Tree of Knowledge, they grew the Elm of False Dreams. The Elm broadcast despair and distorted desire across the mortal realm, and taught devils the art of possession. The Ignavi took no side in this either, drifting through the abyss for eons, growing only more hollow.",
  },
  {
    // First half of Marek's heresy paragraph — setup only. The strike
    // itself is held for the next screen/image (see TRD §3 note).
    image: '/public/narrative/7-Marek.jpg',
    text: "For eons Marek wrought misery beside Abaddon, certain that enough suffering would force Elyon to relent. But he was also curious of Elyon's plan. Marek possessed mortal bodies as an observer, and started to witness their growth.",
  },
  {
    image: '/public/narrative/8-SacrificalStrike.jpg',
    text: "Everything shattered the day he inhabited a dying youth shielding a stranger with her own body—no reward waiting, no bargain struck. That unshielded strike of love tore through his demonic heart and birthed a heresy: Maybe Elyon was right. And maybe, if Earth was a forge for moral evolution, were the fallen cast down not to tempt, but to also grow?",
  },
  {
    image: '/public/narrative/9-Ignavi.jpg',
    text: "Branded a traitor and exiled for preaching it, Marek spent a millennium in the mortal world, weaving quiet light into human history and art. It was not enough; his torment endured and he sought a greater purpose. In his despair he turned at last to the Ignavi, the ones he'd once scorned as spineless. If the demons would not hear him, perhaps they would. What he found were not cowards, but souls each carrying a private reason for their paralysis. After all this time, some were willing to join Marek on a daring crusade.",
  },
  {
    image: '/public/narrative/10-YawningFissure.jpg',
    text: "With these Ignavi, Marek returns to the gates of Hell to ignite an impossible revolution: to burn the Elm of False Dreams, shatter the stagnant order of the abyss, and offer every soul brave enough a new path. If they succeed, they hope to earn their redemption.",
  },
];
