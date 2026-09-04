"""Named corners, per circuit.

fastf1's `circuit_info.corners` gives a number, a letter and a position — never
a name. Names are the thing commentary actually uses ("he's lost it at
Ascari"), so they have to come from somewhere, and this is that somewhere.

**Only corners with a real, established name are listed.** A circuit whose
turns are genuinely just numbered — Jeddah, Las Vegas, Lusail, Yas Marina —
is absent on purpose, and so are individual turns inside a listed circuit.
Inventing a plausible-sounding name for turn 12 would put a fabrication on
screen next to twenty facts, which is worse than showing the number alone.
The renderer treats a missing name as "no name", not as an error.

Keys are circuit keys from `data/circuits.py`; inner keys are the official turn
numbers fastf1 reports. Where one name spans several corners (a chicane, an
S-curve complex) every corner in it carries the name, because the map labels
corners individually and a gap in the middle of Ascari reads as a mistake.
"""

TURN_NAMES: dict[str, dict[int, str]] = {
    "monza": {
        1: "Variante del Rettifilo",
        2: "Variante del Rettifilo",
        3: "Curva Grande",
        4: "Variante della Roggia",
        5: "Variante della Roggia",
        6: "Curva di Lesmo 1",
        7: "Curva di Lesmo 2",
        8: "Curva del Serraglio",
        9: "Variante Ascari",
        10: "Variante Ascari",
        11: "Curva Parabolica",
    },
    "spa": {
        1: "La Source",
        2: "Eau Rouge",
        3: "Raidillon",
        5: "Les Combes",
        6: "Malmedy",
        7: "Rivage",
        9: "Bruxelles",
        10: "Pouhon",
        11: "Pouhon",
        12: "Fagnes",
        13: "Fagnes",
        14: "Stavelot",
        15: "Curve Paul Frère",
        16: "Blanchimont",
        17: "Blanchimont",
        18: "Bus Stop",
        19: "Bus Stop",
    },
    "silverstone": {
        1: "Abbey",
        2: "Farm Curve",
        3: "Village",
        4: "The Loop",
        5: "Aintree",
        6: "Brooklands",
        7: "Luffield",
        8: "Woodcote",
        9: "Copse",
        10: "Maggotts",
        11: "Becketts",
        12: "Chapel",
        13: "Stowe",
        14: "Vale",
        15: "Club",
    },
    "monaco": {
        1: "Sainte Dévote",
        2: "Beau Rivage",
        3: "Massenet",
        4: "Casino",
        5: "Mirabeau Haute",
        6: "Grand Hotel Hairpin",
        7: "Mirabeau Bas",
        8: "Portier",
        9: "Tunnel",
        10: "Nouvelle Chicane",
        11: "Nouvelle Chicane",
        12: "Tabac",
        13: "Louis Chiron",
        14: "Piscine",
        15: "Piscine",
        16: "La Rascasse",
        17: "Anthony Noghès",
    },
    "suzuka": {
        1: "First Curve",
        2: "Second Curve",
        3: "S Curves",
        4: "S Curves",
        5: "S Curves",
        6: "S Curves",
        7: "Dunlop Curve",
        8: "Degner 1",
        9: "Degner 2",
        11: "Hairpin",
        13: "Spoon Curve",
        14: "Spoon Curve",
        15: "130R",
        16: "Casio Triangle",
        17: "Casio Triangle",
    },
    "zandvoort": {
        1: "Tarzanbocht",
        2: "Gerlachbocht",
        3: "Hugenholtzbocht",
        4: "Hunserug",
        5: "Rob Slotemakerbocht",
        7: "Scheivlak",
        8: "Mastersbocht",
        9: "Renaultbocht",
        10: "Hans Ernst Bocht",
        11: "Hans Ernst Bocht",
        12: "Kumhobocht",
        13: "Arie Luyendykbocht",
        14: "Arie Luyendykbocht",
    },
    "red_bull_ring": {
        1: "Niki Lauda Kurve",
        3: "Remus",
        4: "Schlossgold",
        6: "Rindt Kurve",
        9: "Rauch",
        10: "Red Bull Mobile Kurve",
    },
    "interlagos": {
        1: "Senna S",
        2: "Senna S",
        3: "Curva do Sol",
        4: "Descida do Lago",
        6: "Ferradura",
        8: "Laranja",
        9: "Pinheirinho",
        10: "Bico de Pato",
        11: "Mergulho",
        12: "Junção",
        13: "Subida dos Boxes",
        14: "Arquibancadas",
        15: "Arquibancadas",
    },
    "barcelona": {
        1: "Elf",
        3: "Renault",
        5: "Seat",
        7: "Würth",
        9: "Campsa",
        10: "La Caixa",
        12: "Banc Sabadell",
        13: "New Holland",
        14: "Europcar",
    },
    "montreal": {
        1: "Virage Senna",
        2: "Virage Senna",
        10: "L'Épingle",
        13: "Wall of Champions",
        14: "Wall of Champions",
    },
    "mexico_city": {
        4: "Moisés Solana",
        12: "Foro Sol",
        13: "Foro Sol",
        14: "Foro Sol",
        15: "Foro Sol",
        16: "Peraltada",
        17: "Peraltada",
    },
}


def names_for(circuit_key: str | None) -> dict[int, str]:
    """Turn-number -> name for a circuit; empty when none are established."""
    if not circuit_key:
        return {}
    return TURN_NAMES.get(circuit_key, {})
