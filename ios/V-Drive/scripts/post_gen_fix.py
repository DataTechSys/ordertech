#!/usr/bin/env python3
import re
from pathlib import Path

pbx = Path('DisplayApp.xcodeproj/project.pbxproj')
text = pbx.read_text()

# Remove PBXFileReference for OrderTechCore local folder
text = re.sub(r"\n\t\t[A-F0-9]{24} \/\* OrderTechCore \*\/ = \{isa = PBXFileReference;[^\n]*path = \.\./OrderTechCore;[^\n]*\};\n", "\n", text)

# Remove any child entry referencing OrderTechCore in groups
text = re.sub(r"\n\t\t\t\t[A-F0-9]{24} \/\* OrderTechCore \*\/,\n", "\n", text)

pbx.write_text(text)
print('Stripped local folder reference to ../OrderTechCore from project.pbxproj')
