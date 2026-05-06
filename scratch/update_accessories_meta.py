import json
import os

ACCESSORIES_FILE = '/Users/scottieryan/Documents/Claude/Projects/Agent Management/shared/accessories.json'

with open(ACCESSORIES_FILE, 'r') as f:
    data = json.load(f)

mapping = {
    "/accessories/accessories_set_1_item_01.png": {"name": "Reading Glasses", "description": "Classic black frames for a scholarly look.", "labels": ["Scholar", "Vision", "Accessory"]},
    "/accessories/accessories_set_1_item_02.png": {"name": "Artist Beret", "description": "A stylish red beret for creative minds.", "labels": ["Art", "Style", "Headwear"]},
    "/accessories/accessories_set_1_item_03.png": {"name": "Digital Tablet", "description": "A high-performance tablet for on-the-go productivity.", "labels": ["Tech", "Design", "Tool"]},
    "/accessories/accessories_set_1_item_04.png": {"name": "Logic Cube", "description": "A colorful 3D puzzle for sharpening the mind.", "labels": ["Game", "Logic", "Toy"]},
    "/accessories/accessories_set_1_item_05.png": {"name": "Paint Palette", "description": "A wooden palette with a spectrum of vibrant oil paints.", "labels": ["Art", "Painting", "Creative"]},
    "/accessories/accessories_set_1_item_06.png": {"name": "Classical Cello", "description": "A handcrafted wooden cello for musical depth.", "labels": ["Music", "Instrument", "Classy"]},
    "/accessories/accessories_set_1_item_07.png": {"name": "Chef's Pot", "description": "A stainless steel pot for culinary excellence.", "labels": ["Cooking", "Chef", "Kitchen"]},
    "/accessories/accessories_set_1_item_08.png": {"name": "World Globe", "description": "A vintage-style globe for global explorers.", "labels": ["Travel", "Education", "Explorer"]},
    "/accessories/accessories_set_1_item_09.png": {"name": "Pretzel Heart", "description": "A heart-shaped snack full of salty love.", "labels": ["Food", "Love", "Snack"]},
    "/accessories/accessories_set_1_item_10.png": {"name": "Golden Ring", "description": "A simple but elegant gold band.", "labels": ["Jewelry", "Elegance", "Accessory"]},
    "/accessories/accessories_set_1_item_11.png": {"name": "Watering Can", "description": "A rustic can for nurturing growth.", "labels": ["Garden", "Nature", "Tool"]},
    "/accessories/accessories_set_1_item_12.png": {"name": "Color Swatches", "description": "A fan of color samples for design decisions.", "labels": ["Design", "Art", "Samples"]},
    "/accessories/accessories_set_1_item_13.png": {"name": "Architect Blueprint", "description": "Detailed plans for complex structures.", "labels": ["Architecture", "Engineering", "Plans"]},
    "/accessories/accessories_set_1_item_14.png": {"name": "Lounge Armchair", "description": "A comfortable chair for deep thinking.", "labels": ["Furniture", "Comfort", "Office"]},
    "/accessories/accessories_set_1_item_15.png": {"name": "Gift Box", "description": "A wrapped present with a red ribbon.", "labels": ["Holiday", "Gift", "Surprise"]},
    "/accessories/accessories_set_1_item_16.png": {"name": "Retro Television", "description": "A classic TV set for media consumption.", "labels": ["Media", "Retro", "Tech"]},
    "/accessories/accessories_set_1_item_17.png": {"name": "Microscope", "description": "High-power optics for scientific discovery.", "labels": ["Science", "Research", "Lab"]},
    "/accessories/accessories_set_1_item_18.png": {"name": "Wrench", "description": "A heavy-duty tool for mechanical repairs.", "labels": ["Tool", "Engineering", "Fix"]},
    "/accessories/accessories_set_1_item_19.png": {"name": "Sewing Machine", "description": "Vintage machine for tailoring and design.", "labels": ["Craft", "Design", "Textile"]},
    "/accessories/accessories_set_1_item_20.png": {"name": "Office Calculator", "description": "A precise tool for financial calculations.", "labels": ["Finance", "Math", "Tool"]},
    "/accessories/accessories_set_1_item_21.png": {"name": "Balance Scale", "description": "Brass scales for weighing justice or assets.", "labels": ["Law", "Finance", "Justice"]},
    "/accessories/accessories_set_1_item_22.png": {"name": "Zen Garden Stones", "description": "Smooth stones for mindfulness and balance.", "labels": ["Peace", "Zen", "Nature"]},
    "/accessories/accessories_set_1_item_23.png": {"name": "Professional Camera", "description": "High-end DSLR for capturing moments.", "labels": ["Photography", "Media", "Travel"]},
    "/accessories/accessories_set_1_item_24.png": {"name": "Chef Knives", "description": "A set of sharp blades for the master chef.", "labels": ["Cooking", "Chef", "Kitchen"]},
    "/accessories/accessories_set_1_item_25.png": {"name": "Vintage Typewriter", "description": "Mechanical keys for the dedicated writer.", "labels": ["Writing", "Retro", "Author"]},

    "/accessories/accessories_set_2_item_01.png": {"name": "Astronomer Telescope", "description": "Look into the far reaches of the universe.", "labels": ["Science", "Astronomy", "Discovery"]},
    "/accessories/accessories_set_2_item_02.png": {"name": "Forest Mushroom", "description": "A small fungi from the deep woods.", "labels": ["Nature", "Forest", "Small"]},
    "/accessories/accessories_set_2_item_03.png": {"name": "Postal Letter", "description": "An envelope sealed with care.", "labels": ["Communication", "Mail", "Secret"]},
    "/accessories/accessories_set_2_item_04.png": {"name": "Critical D20", "description": "A 20-sided die for high-stakes decisions.", "labels": ["Game", "Luck", "Roleplay"]},
    "/accessories/accessories_set_2_item_05.png": {"name": "Jazz Saxophone", "description": "Brass instrument for soulful melodies.", "labels": ["Music", "Jazz", "Classy"]},
    "/accessories/accessories_set_2_item_06.png": {"name": "Safety Lighthouse", "description": "A beacon of light in the storm.", "labels": ["Safety", "Navigation", "Hope"]},
    "/accessories/accessories_set_2_item_07.png": {"name": "Studio Microphone", "description": "Capture crystal clear audio.", "labels": ["Media", "Audio", "Voice"]},
    "/accessories/accessories_set_2_item_08.png": {"name": "Boxing Gloves", "description": "Heavy padding for the ring.", "labels": ["Sport", "Power", "Defense"]},
    "/accessories/accessories_set_2_item_09.png": {"name": "Retro Calculator", "description": "Old-school math on your desk.", "labels": ["Math", "Retro", "Tool"]},
    "/accessories/accessories_set_2_item_10.png": {"name": "Drafting Pencils", "description": "Sharp leads for technical drawings.", "labels": ["Design", "Art", "Drawing"]},
    "/accessories/accessories_set_2_item_11.png": {"name": "Wind Turbine", "description": "Sustainable energy for the future.", "labels": ["Green", "Energy", "Science"]},
    "/accessories/accessories_set_2_item_12.png": {"name": "Building Blocks", "description": "Simple shapes for complex foundations.", "labels": ["Game", "Education", "Logic"]},
    "/accessories/accessories_set_2_item_13.png": {"name": "Audio Headphones", "description": "Immersive sound for focused work.", "labels": ["Media", "Audio", "Focus"]},
    "/accessories/accessories_set_2_item_14.png": {"name": "Penrose Stairs", "description": "An impossible geometric puzzle.", "labels": ["Logic", "Mind", "Art"]},
    "/accessories/accessories_set_2_item_15.png": {"name": "Adventure Boots", "description": "Sturdy footwear for long journeys.", "labels": ["Travel", "Nature", "Adventure"]},
    "/accessories/accessories_set_2_item_16.png": {"name": "Navigation Compass", "description": "Never lose your way.", "labels": ["Travel", "Navigation", "Tool"]},
    "/accessories/accessories_set_2_item_17.png": {"name": "Emerald Ring", "description": "A silver band with a green stone.", "labels": ["Jewelry", "Elegance", "Style"]},
    "/accessories/accessories_set_2_item_18.png": {"name": "The Thinker", "description": "Iconic statue of deep contemplation.", "labels": ["Mind", "Philosophy", "Art"]},
    "/accessories/accessories_set_2_item_19.png": {"name": "Smooth River Stones", "description": "Stackable stones for meditative focus.", "labels": ["Peace", "Zen", "Nature"]},
    "/accessories/accessories_set_2_item_20.png": {"name": "Precious Jewels", "description": "A collection of cut gemstones.", "labels": ["Wealth", "Jewelry", "Status"]},
    "/accessories/accessories_set_2_item_21.png": {"name": "Industrial Robot Arm", "description": "Precision automation for complex tasks.", "labels": ["Tech", "Robotics", "Future"]},
    "/accessories/accessories_set_2_item_22.png": {"name": "Classic Typewriter", "description": "The author's best friend.", "labels": ["Writing", "Retro", "Media"]},
    "/accessories/accessories_set_2_item_23.png": {"name": "Victory Trophies", "description": "Symbols of peak achievement.", "labels": ["Status", "Power", "Award"]},
    "/accessories/accessories_set_2_item_24.png": {"name": "Volcanic Rocks", "description": "Raw geological samples.", "labels": ["Science", "Nature", "Geology"]},
    "/accessories/accessories_set_2_item_25.png": {"name": "Leather Journal", "description": "A place for private thoughts.", "labels": ["Writing", "Memory", "Classy"]},
}

for path, info in data['items'].items():
    if path in mapping:
        data['items'][path].update(mapping[path])
    else:
        # Generic fallback for the remaining 100
        set_num = path.split('_set_')[1].split('_')[0]
        item_num = path.split('_item_')[1].split('.')[0]
        data['items'][path].update({
            "name": f"Accessory {set_num}-{item_num}",
            "description": f"A specialized tool for the agent's unique needs.",
            "labels": ["Accessory", f"Set {set_num}"]
        })

with open(ACCESSORIES_FILE, 'w') as f:
    json.dump(data, f, indent=2)

print("Updated accessories.json with metadata.")
