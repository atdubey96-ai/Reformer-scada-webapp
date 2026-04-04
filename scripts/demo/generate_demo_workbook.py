#!/usr/bin/env python3

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
import xml.etree.ElementTree as ET
import zipfile


NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_DOCREL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS_CP = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
NS_DC = "http://purl.org/dc/elements/1.1/"
NS_DCTERMS = "http://purl.org/dc/terms/"
NS_DCMITYPE = "http://purl.org/dc/dcmitype/"
NS_XSI = "http://www.w3.org/2001/XMLSchema-instance"
NS_VT = "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"
NS_APP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"


ET.register_namespace("", NS_MAIN)
ET.register_namespace("r", NS_DOCREL)
ET.register_namespace("cp", NS_CP)
ET.register_namespace("dc", NS_DC)
ET.register_namespace("dcterms", NS_DCTERMS)
ET.register_namespace("dcmitype", NS_DCMITYPE)
ET.register_namespace("xsi", NS_XSI)
ET.register_namespace("vt", NS_VT)


DEMO_ROWS = [
    ("FIC2405", "GJA.2041fic2405.pv", "Nm3/h", "Feed Flow Mixing Point", "Demo source for HGU load", 19479.43),
    ("TI2501", "GJA.2041ti2501.pv", "degC", "AB Side COT", "Demo current value", 838.42),
    ("TI2502", "GJA.2041ti2502.pv", "degC", "CD Side COT", "Demo current value", 828.99),
    ("TI2408", "GJA.2041ti2408.pv", "degC", "Flue Gas Temp", "Demo current value", 911.80),
    ("TIC2411", "GJA.2041tic2411.pv", "degC", "Pre-reformer Inlet", "Demo current value", 447.32),
    ("TI2412", "GJA.2041ti2412.pv", "degC", "Pre-reformer Outlet", "Demo current value", 485.70),
    ("FIC2904", "GJA.2041fic2904.pv", "Nm3/h", "PSA-1 Off Gas", "Demo current value", 33014.14),
    ("FIC3009", "GJA.2041fic3009.pv", "Nm3/h", "PSA-2 Off Gas", "Demo current value", 0.00),
    ("FIC6303A", "GJA.2041fic6303a.pv", "kg/h", "Naphtha Fuel", "Demo current value", 1207.42),
    ("PI2507A", "GJA.2041pi2507a.pv", "kg/cm2", "Naphtha Tip Pressure", "Demo current value", 0.37),
    ("PI2504A", "GJA.2041pi2504a.pv", "kg/cm2", "Natural Gas Tip Pressure", "Demo current value", 0.38),
    ("PI2501A", "GJA.2041pi2501a.pv", "kg/cm2", "PSA-1 Off Gas Tip Pressure", "Demo current value", 0.06),
    ("AI2401", "GJA.2041ai2401.pv", "%Vol", "Excess O2", "Demo current value", 6.36),
    ("AI2601", "GJA.2041ai2601.pv", "%Vol", "Methane Slip", "Demo current value", 3.36),
]


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    default_dest = root / "webapp" / "Data_website_demo.xlsx"
    parser = argparse.ArgumentParser(description="Generate a clean SCADA demo workbook.")
    parser.add_argument("--dest", default=str(default_dest))
    parser.add_argument(
        "--source",
        default="",
        help="Accepted for compatibility with older scripts but not used.",
    )
    return parser.parse_args()


def col_letter(index: int) -> str:
    result = []
    while index > 0:
        index, remainder = divmod(index - 1, 26)
        result.append(chr(65 + remainder))
    return "".join(reversed(result))


def make_cell_ref(col_index: int, row_index: int) -> str:
    return f"{col_letter(col_index)}{row_index}"


def inline_string_cell(parent: ET.Element, ref: str, text: str) -> None:
    cell = ET.SubElement(parent, f"{{{NS_MAIN}}}c", {"r": ref, "t": "inlineStr"})
    inline = ET.SubElement(cell, f"{{{NS_MAIN}}}is")
    text_el = ET.SubElement(inline, f"{{{NS_MAIN}}}t")
    text_el.text = text


def numeric_cell(parent: ET.Element, ref: str, value: float | int) -> None:
    cell = ET.SubElement(parent, f"{{{NS_MAIN}}}c", {"r": ref})
    val = ET.SubElement(cell, f"{{{NS_MAIN}}}v")
    val.text = str(value)


def string_number(value: float) -> str:
    text = f"{value:.2f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def build_sheet_xml() -> bytes:
    worksheet = ET.Element(f"{{{NS_MAIN}}}worksheet")
    ET.SubElement(worksheet, f"{{{NS_MAIN}}}dimension", {"ref": "B1:H17"})
    sheet_views = ET.SubElement(worksheet, f"{{{NS_MAIN}}}sheetViews")
    ET.SubElement(sheet_views, f"{{{NS_MAIN}}}sheetView", {"workbookViewId": "0", "tabSelected": "1"})
    ET.SubElement(worksheet, f"{{{NS_MAIN}}}sheetFormatPr", {"defaultRowHeight": "15"})

    cols = ET.SubElement(worksheet, f"{{{NS_MAIN}}}cols")
    widths = {
        2: "18",
        4: "24",
        5: "14",
        6: "30",
        7: "26",
        8: "14",
    }
    for index, width in widths.items():
        ET.SubElement(cols, f"{{{NS_MAIN}}}col", {
            "min": str(index),
            "max": str(index),
            "width": width,
            "customWidth": "1",
        })

    data = ET.SubElement(worksheet, f"{{{NS_MAIN}}}sheetData")

    row1 = ET.SubElement(data, f"{{{NS_MAIN}}}row", {"r": "1"})
    inline_string_cell(row1, "B1", "SCADA Demo Workbook")
    inline_string_cell(row1, "D1", "Generated At")
    inline_string_cell(row1, "E1", "Waiting for demo publisher")

    row2 = ET.SubElement(data, f"{{{NS_MAIN}}}row", {"r": "2"})
    inline_string_cell(row2, "B2", "Open this workbook and keep it visible during demo mode.")

    row3 = ET.SubElement(data, f"{{{NS_MAIN}}}row", {"r": "3"})
    inline_string_cell(row3, "B3", "Tag")
    inline_string_cell(row3, "D3", "Tag ID")
    inline_string_cell(row3, "E3", "Unit")
    inline_string_cell(row3, "F3", "Description")
    inline_string_cell(row3, "G3", "Notes")
    inline_string_cell(row3, "H3", "Waiting for demo publisher")

    for offset, row in enumerate(DEMO_ROWS, start=4):
        tag_short, tag_id, unit, description, notes, value = row
        row_el = ET.SubElement(data, f"{{{NS_MAIN}}}row", {"r": str(offset)})
        inline_string_cell(row_el, make_cell_ref(2, offset), tag_short)
        inline_string_cell(row_el, make_cell_ref(4, offset), tag_id)
        inline_string_cell(row_el, make_cell_ref(5, offset), unit)
        inline_string_cell(row_el, make_cell_ref(6, offset), description)
        inline_string_cell(row_el, make_cell_ref(7, offset), notes)
        numeric_cell(row_el, make_cell_ref(8, offset), float(string_number(value)))

    ET.SubElement(worksheet, f"{{{NS_MAIN}}}pageMargins", {
        "left": "0.7",
        "right": "0.7",
        "top": "0.75",
        "bottom": "0.75",
        "header": "0.3",
        "footer": "0.3",
    })
    return ET.tostring(worksheet, encoding="utf-8", xml_declaration=True)


def build_workbook_xml() -> bytes:
    workbook = ET.Element(f"{{{NS_MAIN}}}workbook", {f"{{{NS_DOCREL}}}dummy": ""})
    workbook.attrib.pop(f"{{{NS_DOCREL}}}dummy")
    sheets = ET.SubElement(workbook, f"{{{NS_MAIN}}}sheets")
    ET.SubElement(sheets, f"{{{NS_MAIN}}}sheet", {
        "name": "Sheet1",
        "sheetId": "1",
        f"{{{NS_DOCREL}}}id": "rId1",
    })
    return ET.tostring(workbook, encoding="utf-8", xml_declaration=True)


def build_workbook_rels_xml() -> bytes:
    relationships = ET.Element(f"{{{NS_REL}}}Relationships")
    ET.SubElement(relationships, f"{{{NS_REL}}}Relationship", {
        "Id": "rId1",
        "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
        "Target": "worksheets/sheet1.xml",
    })
    ET.SubElement(relationships, f"{{{NS_REL}}}Relationship", {
        "Id": "rId2",
        "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
        "Target": "styles.xml",
    })
    return ET.tostring(relationships, encoding="utf-8", xml_declaration=True)


def build_root_rels_xml() -> bytes:
    relationships = ET.Element(f"{{{NS_REL}}}Relationships")
    ET.SubElement(relationships, f"{{{NS_REL}}}Relationship", {
        "Id": "rId1",
        "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        "Target": "xl/workbook.xml",
    })
    ET.SubElement(relationships, f"{{{NS_REL}}}Relationship", {
        "Id": "rId2",
        "Type": "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        "Target": "docProps/core.xml",
    })
    ET.SubElement(relationships, f"{{{NS_REL}}}Relationship", {
        "Id": "rId3",
        "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
        "Target": "docProps/app.xml",
    })
    return ET.tostring(relationships, encoding="utf-8", xml_declaration=True)


def build_content_types_xml() -> bytes:
    types = ET.Element(f"{{{NS_CT}}}Types")
    ET.SubElement(types, f"{{{NS_CT}}}Default", {
        "Extension": "rels",
        "ContentType": "application/vnd.openxmlformats-package.relationships+xml",
    })
    ET.SubElement(types, f"{{{NS_CT}}}Default", {
        "Extension": "xml",
        "ContentType": "application/xml",
    })
    overrides = [
        ("/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),
        ("/xl/worksheets/sheet1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"),
        ("/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"),
        ("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"),
        ("/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"),
    ]
    for part_name, content_type in overrides:
        ET.SubElement(types, f"{{{NS_CT}}}Override", {
            "PartName": part_name,
            "ContentType": content_type,
        })
    return ET.tostring(types, encoding="utf-8", xml_declaration=True)


def build_styles_xml() -> bytes:
    style_sheet = ET.Element(f"{{{NS_MAIN}}}styleSheet")
    fonts = ET.SubElement(style_sheet, f"{{{NS_MAIN}}}fonts", {"count": "1"})
    font = ET.SubElement(fonts, f"{{{NS_MAIN}}}font")
    ET.SubElement(font, f"{{{NS_MAIN}}}sz", {"val": "11"})
    ET.SubElement(font, f"{{{NS_MAIN}}}name", {"val": "Calibri"})
    ET.SubElement(font, f"{{{NS_MAIN}}}family", {"val": "2"})

    fills = ET.SubElement(style_sheet, f"{{{NS_MAIN}}}fills", {"count": "2"})
    fill_none = ET.SubElement(fills, f"{{{NS_MAIN}}}fill")
    ET.SubElement(fill_none, f"{{{NS_MAIN}}}patternFill", {"patternType": "none"})
    fill_gray = ET.SubElement(fills, f"{{{NS_MAIN}}}fill")
    ET.SubElement(fill_gray, f"{{{NS_MAIN}}}patternFill", {"patternType": "gray125"})

    borders = ET.SubElement(style_sheet, f"{{{NS_MAIN}}}borders", {"count": "1"})
    border = ET.SubElement(borders, f"{{{NS_MAIN}}}border")
    ET.SubElement(border, f"{{{NS_MAIN}}}left")
    ET.SubElement(border, f"{{{NS_MAIN}}}right")
    ET.SubElement(border, f"{{{NS_MAIN}}}top")
    ET.SubElement(border, f"{{{NS_MAIN}}}bottom")
    ET.SubElement(border, f"{{{NS_MAIN}}}diagonal")

    cell_style_xfs = ET.SubElement(style_sheet, f"{{{NS_MAIN}}}cellStyleXfs", {"count": "1"})
    ET.SubElement(cell_style_xfs, f"{{{NS_MAIN}}}xf", {
        "numFmtId": "0",
        "fontId": "0",
        "fillId": "0",
        "borderId": "0",
    })

    cell_xfs = ET.SubElement(style_sheet, f"{{{NS_MAIN}}}cellXfs", {"count": "1"})
    ET.SubElement(cell_xfs, f"{{{NS_MAIN}}}xf", {
        "numFmtId": "0",
        "fontId": "0",
        "fillId": "0",
        "borderId": "0",
        "xfId": "0",
    })

    cell_styles = ET.SubElement(style_sheet, f"{{{NS_MAIN}}}cellStyles", {"count": "1"})
    ET.SubElement(cell_styles, f"{{{NS_MAIN}}}cellStyle", {
        "name": "Normal",
        "xfId": "0",
        "builtinId": "0",
    })
    return ET.tostring(style_sheet, encoding="utf-8", xml_declaration=True)


def build_core_xml() -> bytes:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    core = ET.Element(f"{{{NS_CP}}}coreProperties")
    creator = ET.SubElement(core, f"{{{NS_DC}}}creator")
    creator.text = "Codex"
    ET.SubElement(core, f"{{{NS_CP}}}lastModifiedBy").text = "Codex"
    created = ET.SubElement(core, f"{{{NS_DCTERMS}}}created", {f"{{{NS_XSI}}}type": "dcterms:W3CDTF"})
    created.text = now
    modified = ET.SubElement(core, f"{{{NS_DCTERMS}}}modified", {f"{{{NS_XSI}}}type": "dcterms:W3CDTF"})
    modified.text = now
    return ET.tostring(core, encoding="utf-8", xml_declaration=True)


def build_app_xml() -> bytes:
    properties = ET.Element(f"{{{NS_APP}}}Properties")
    ET.SubElement(properties, f"{{{NS_APP}}}Application").text = "Microsoft Excel"
    ET.SubElement(properties, f"{{{NS_APP}}}DocSecurity").text = "0"
    ET.SubElement(properties, f"{{{NS_APP}}}ScaleCrop").text = "false"
    headings = ET.SubElement(properties, f"{{{NS_APP}}}HeadingPairs")
    vector = ET.SubElement(headings, f"{{{NS_VT}}}vector", {"size": "2", "baseType": "variant"})
    variant_1 = ET.SubElement(vector, f"{{{NS_VT}}}variant")
    ET.SubElement(variant_1, f"{{{NS_VT}}}lpstr").text = "Worksheets"
    variant_2 = ET.SubElement(vector, f"{{{NS_VT}}}variant")
    ET.SubElement(variant_2, f"{{{NS_VT}}}i4").text = "1"
    titles = ET.SubElement(properties, f"{{{NS_APP}}}TitlesOfParts")
    title_vector = ET.SubElement(titles, f"{{{NS_VT}}}vector", {"size": "1", "baseType": "lpstr"})
    ET.SubElement(title_vector, f"{{{NS_VT}}}lpstr").text = "Sheet1"
    ET.SubElement(properties, f"{{{NS_APP}}}Company").text = ""
    ET.SubElement(properties, f"{{{NS_APP}}}LinksUpToDate").text = "false"
    ET.SubElement(properties, f"{{{NS_APP}}}SharedDoc").text = "false"
    ET.SubElement(properties, f"{{{NS_APP}}}HyperlinksChanged").text = "false"
    ET.SubElement(properties, f"{{{NS_APP}}}AppVersion").text = "16.0300"
    return ET.tostring(properties, encoding="utf-8", xml_declaration=True)


def iter_package_parts() -> Iterable[tuple[str, bytes]]:
    yield "[Content_Types].xml", build_content_types_xml()
    yield "_rels/.rels", build_root_rels_xml()
    yield "xl/workbook.xml", build_workbook_xml()
    yield "xl/_rels/workbook.xml.rels", build_workbook_rels_xml()
    yield "xl/worksheets/sheet1.xml", build_sheet_xml()
    yield "xl/styles.xml", build_styles_xml()
    yield "docProps/core.xml", build_core_xml()
    yield "docProps/app.xml", build_app_xml()


def generate_workbook(dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in iter_package_parts():
            archive.writestr(name, payload)


def main() -> int:
    args = parse_args()
    dest = Path(args.dest).expanduser().resolve()
    generate_workbook(dest)
    print(f"Generated demo workbook: {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
