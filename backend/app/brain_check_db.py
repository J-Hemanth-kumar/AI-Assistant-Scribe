import uuid
from app.db.session import SessionLocal
from app.db.models import DocumentVersion, ParsedContent

with SessionLocal() as db:
    # Get latest version
    dv = db.query(DocumentVersion).order_by(DocumentVersion.id.desc()).first()
    if dv:
        print(f"Version ID: {dv.id}, Doc ID: {dv.doc_id}")
        print(f"Prompt: {dv.prompt}")
        print(f"Edits JSON: {dv.edit_diff_json}")
        
        # Check chunk 0 of that doc
        pc = db.query(ParsedContent).filter(ParsedContent.doc_id == dv.doc_id, ParsedContent.block_index == 0).first()
        if pc:
            print(f"Chunk 0 Text: '{pc.text}'")
    else:
        print("No versions found.")
