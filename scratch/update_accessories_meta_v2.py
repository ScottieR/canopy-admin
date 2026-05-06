import json
import os

ACCESSORIES_FILE = "/Users/scottieryan/Documents/Claude/Projects/Agent Management/shared/accessories.json"

def update_accessories():
    if not os.path.exists(ACCESSORIES_FILE):
        print("File not found")
        return

    with open(ACCESSORIES_FILE, 'r') as f:
        data = json.load(f)

    # Set 3: Music & Entertainment
    set3_names = [
        "Vintage Saxophone", "Electric Guitar", "Daft Helmet", "Neon Headphones", "DJ Turntable",
        "Golden Microphone", "Harmonica", "Drum Sticks", "Synthesizer Key", "Concert Ticket",
        "Disco Ball", "Stage Spotlight", "Acoustic Ukulele", "Grand Piano", "Vinyl Record",
        "Boombox", "Jazz Hat", "Sheet Music", "Metronome", "Opera Glasses",
        "Tambourine", "Silver Flute", "Rock Star Wig", "VIP Pass", "Karaoke Machine"
    ]
    
    # Set 4: Science & Exploration
    set4_names = [
        "Microscope", "Beaker Set", "Space Helmet", "Telescope", "Compass",
        "Map Scroll", "Laboratory Flask", "DNA Helix", "Rocket Model", "Atom Charm",
        "Geological Hammer", "Petri Dish", "Radiation Badge", "Jetpack", "Moon Stone",
        "Satellite Dish", "Diving Mask", "Oxygen Tank", "Fossil Brush", "Biohazard Suit",
        "Magnifying Glass", "Compass Watch", "Star Map", "Rover Wheel", "Drone Controller"
    ]

    # Set 5: Luxury & Fashion
    set5_names = [
        "Designer Purse", "Silk Scarf", "Diamond Watch", "Gold Chain", "Sunglasses",
        "Leather Briefcase", "Velvet Cape", "Ruby Tiara", "Tuxedo Bow", "Perfume Bottle",
        "Cufflinks", "Evening Gown", "Stiletto Heel", "Top Hat", "Monocle",
        "Pearl Necklace", "Fur Stole", "Silver Cane", "Platinum Credit Card", "Champagne Flute",
        "Limo Keys", "Mirror Compact", "Fashion Magazine", "Lipstick", "Manicure Set"
    ]

    # Set 6: Tech & Cyberpunk
    set6_names = [
        "Neural Link", "Cyber Eye", "Data Chip", "Laser Sword", "Plasma Shield",
        "Hologram Projector", "Hack Device", "Energy Core", "Droid Head", "Neon Katana",
        "Gravity Boot", "Cloaking Device", "Signal Jammer", "Quantum CPU", "Circuit Board",
        "VR Goggles", "Cyber Arm", "Flash Drive", "encrypted Tablet", "Pulse Pistol",
        "Smart Watch", "Binary Scarf", "Mech Pilot Helmet", "Server Rack", "AI Core"
    ]

    sets = [set3_names, set4_names, set5_names, set6_names]
    
    for s_idx, names in enumerate(sets):
        set_num = s_idx + 3
        for i, name in enumerate(names):
            item_num = str(i + 1).zfill(2)
            key = f"/accessories/accessories_set_{set_num}_item_{item_num}.png"
            
            if key in data['items']:
                data['items'][key]['name'] = name
                data['items'][key]['description'] = f"A premium {name.lower()} accessory for high-end agent styling."
                # Add some specific labels
                labels = ["Accessory", f"Set {set_num}"]
                if set_num == 3: labels.append("Music")
                if set_num == 4: labels.append("Science")
                if set_num == 5: labels.append("Luxury")
                if set_num == 6: labels.append("Tech")
                data['items'][key]['labels'] = labels

    with open(ACCESSORIES_FILE, 'w') as f:
        json.dump(data, f, indent=2)

if __name__ == "__main__":
    update_accessories()
