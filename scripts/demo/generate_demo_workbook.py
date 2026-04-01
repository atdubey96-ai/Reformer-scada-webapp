#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET


NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_DOCREL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_X14AC = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"
NS_XR = "http://schemas.microsoft.com/office/spreadsheetml/2014/revision"
NS_XR2 = "http://schemas.microsoft.com/office/spreadsheetml/2015/revision2"
NS_XR3 = "http://schemas.microsoft.com/office/spreadsheetml/2016/revision3"


ET.register_namespace("", NS_MAIN)
ET.register_namespace("r", NS_R)
ET.register_namespace("mc", NS_MC)
ET.register_namespace("x14ac", NS_X14AC)
ET.register_namespace("xr", NS_XR)
ET.register_namespace("xr2", NS_XR2)
ET.register_namespace("xr3", NS_XR3)


REMOVE_ENTRIES = {
    "xl/vbaProject.bin",
    "xl/drawings/drawing1.xml",
    "xl/worksheets/_rels/sheet1.xml.rels",
    "xl/calcChain.xml",
}


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    default_source = root / "webapp" / "Data_website2.xlsm"
    default_dest = root / "webapp" / "Data_website_demo.xlsx"
    parser = argparse.ArgumentParser(description="Generate a macro-free SCADA demo workbook.")
    parser.add_argument("--source", default=str(default_source))
    parser.add_argument("--dest", default=str(default_dest))
    return parser.parse_args()


def mutate_content_types(raw: bytes) -> bytes:
    root = ET.fromstring(raw)
    for child in list(root):
        if child.tag != f"{{{NS_CT}}}Default":
            continue
        if child.attrib.get("Extension") == "bin":
            root.remove(child)
    for child in list(root):
        if child.tag != f"{{{NS_CT}}}Override":
            continue
        part_name = child.attrib.get("PartName")
        if part_name == "/xl/workbook.xml":
            child.set(
                "ContentType",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
            )
        if part_name in {"/xl/drawings/drawing1.xml", "/xl/calcChain.xml"}:
            root.remove(child)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def mutate_workbook_rels(raw: bytes) -> bytes:
    root = ET.fromstring(raw)
    for rel in list(root):
        rel_type = rel.attrib.get("Type", "")
        target = rel.attrib.get("Target", "")
        if rel_type.endswith("/vbaProject") or rel_type.endswith("/calcChain"):
            root.remove(rel)
            continue
        if target in {"vbaProject.bin", "calcChain.xml"}:
            root.remove(rel)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def mutate_sheet(raw: bytes) -> bytes:
    root = ET.fromstring(raw)
    drawing = root.find(f"{{{NS_MAIN}}}drawing")
    if drawing is not None:
        root.remove(drawing)
    for cell in root.findall(f".//{{{NS_MAIN}}}c[@r='D3']"):
        cell.attrib.pop("t", None)
        for child in list(cell):
            cell.remove(child)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def generate_workbook(source: Path, dest: Path) -> None:
    if not source.exists():
        raise FileNotFoundError(f"Source workbook not found: {source}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source, "r") as zin, zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name in zin.namelist():
            if name in REMOVE_ENTRIES:
                continue
            data = zin.read(name)
            if name == "[Content_Types].xml":
                data = mutate_content_types(data)
            elif name == "xl/_rels/workbook.xml.rels":
                data = mutate_workbook_rels(data)
            elif name == "xl/worksheets/sheet1.xml":
                data = mutate_sheet(data)
            zout.writestr(name, data)


def main() -> int:
    args = parse_args()
    source = Path(args.source).expanduser().resolve()
    dest = Path(args.dest).expanduser().resolve()
    generate_workbook(source, dest)
    print(f"Generated demo workbook: {dest}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - CLI surface
        print(f"generate_demo_workbook.py failed: {exc}", file=sys.stderr)
        raise
