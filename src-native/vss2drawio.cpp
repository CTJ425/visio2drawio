#include <iostream>
#include <fstream>
#include <sstream>
#include <vector>
#include <string>
#include <iomanip>
#include <cmath>
#include <algorithm>
#include <cstring>

#include <libvisio/libvisio.h>
#include <librevenge/librevenge.h>
#include <librevenge-stream/librevenge-stream.h>
#include <librevenge/RVNGSVGDrawingGenerator.h>

struct StencilItem {
    std::string name;
    double widthInches;
    double heightInches;
    std::string svg;
};

// Base64 encoder helper
static const std::string base64_chars = 
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "0123456789+/";

static std::string base64_encode(const std::string &in) {
    std::string out;
    int val = 0, valb = -6;
    for (unsigned char c : in) {
        val = (val << 8) + c;
        valb += 8;
        while (valb >= 0) {
            out.push_back(base64_chars[(val >> valb) & 0x3F]);
            valb -= 6;
        }
    }
    if (valb > -6) out.push_back(base64_chars[((val << 8) >> (valb + 8)) & 0x3F]);
    while (out.size() % 4) out.push_back('=');
    return out;
}

static std::string xmlEscape(const std::string &data) {
    std::string buffer;
    buffer.reserve(data.size() * 1.1);
    for (size_t pos = 0; pos != data.size(); ++pos) {
        switch (data[pos]) {
            case '&':  buffer.append("&amp;");       break;
            case '\"': buffer.append("&quot;");      break;
            case '\'': buffer.append("&apos;");      break;
            case '<':  buffer.append("&lt;");        break;
            case '>':  buffer.append("&gt;");        break;
            default:   buffer.append(&data[pos], 1); break;
        }
    }
    return buffer;
}

static std::string jsonEscape(const std::string &data) {
    std::ostringstream ss;
    for (char c : data) {
        switch (c) {
            case '\"': ss << "\\\""; break;
            case '\\': ss << "\\\\"; break;
            case '\b': ss << "\\b";  break;
            case '\f': ss << "\\f";  break;
            case '\n': ss << "\\n";  break;
            case '\r': ss << "\\r";  break;
            case '\t': ss << "\\t";  break;
            default:
                if ('\x00' <= c && c <= '\x1f') {
                    ss << "\\u" << std::hex << std::setw(4) << std::setfill('0') << (int)c;
                } else {
                    ss << c;
                }
        }
    }
    return ss.str();
}

class StencilDelegate : public librevenge::RVNGDrawingInterface {
public:
    librevenge::RVNGStringVector svgVector;
    librevenge::RVNGSVGDrawingGenerator generator;
    std::vector<std::string> names;
    std::vector<double> widths;
    std::vector<double> heights;

    StencilDelegate() : generator(svgVector, "") {}

    void startDocument(const librevenge::RVNGPropertyList &p) override { generator.startDocument(p); }
    void endDocument() override { generator.endDocument(); }
    void setDocumentMetaData(const librevenge::RVNGPropertyList &p) override { generator.setDocumentMetaData(p); }
    void defineEmbeddedFont(const librevenge::RVNGPropertyList &p) override { generator.defineEmbeddedFont(p); }
    void startPage(const librevenge::RVNGPropertyList &p) override {
        std::string name = "";
        if (p["draw:name"]) {
            name = p["draw:name"]->getStr().cstr();
        }
        double w = 1.0, h = 1.0;
        if (p["svg:width"]) {
            w = p["svg:width"]->getDouble();
        }
        if (p["svg:height"]) {
            h = p["svg:height"]->getDouble();
        }
        names.push_back(name);
        widths.push_back(w);
        heights.push_back(h);
        generator.startPage(p);
    }
    void endPage() override { generator.endPage(); }
    void startMasterPage(const librevenge::RVNGPropertyList &p) override { generator.startMasterPage(p); }
    void endMasterPage() override { generator.endMasterPage(); }
    void setStyle(const librevenge::RVNGPropertyList &p) override { generator.setStyle(p); }
    void startLayer(const librevenge::RVNGPropertyList &p) override { generator.startLayer(p); }
    void endLayer() override { generator.endLayer(); }
    void startEmbeddedGraphics(const librevenge::RVNGPropertyList &p) override { generator.startEmbeddedGraphics(p); }
    void endEmbeddedGraphics() override { generator.endEmbeddedGraphics(); }
    void openGroup(const librevenge::RVNGPropertyList &p) override { generator.openGroup(p); }
    void closeGroup() override { generator.closeGroup(); }
    void drawRectangle(const librevenge::RVNGPropertyList &p) override { generator.drawRectangle(p); }
    void drawEllipse(const librevenge::RVNGPropertyList &p) override { generator.drawEllipse(p); }
    void drawPolygon(const librevenge::RVNGPropertyList &p) override { generator.drawPolygon(p); }
    void drawPolyline(const librevenge::RVNGPropertyList &p) override { generator.drawPolyline(p); }
    void drawPath(const librevenge::RVNGPropertyList &p) override { generator.drawPath(p); }
    void drawGraphicObject(const librevenge::RVNGPropertyList &p) override { generator.drawGraphicObject(p); }
    void drawConnector(const librevenge::RVNGPropertyList &p) override { generator.drawConnector(p); }
    void startTextObject(const librevenge::RVNGPropertyList &p) override { generator.startTextObject(p); }
    void endTextObject() override { generator.endTextObject(); }
    void startTableObject(const librevenge::RVNGPropertyList &p) override { generator.startTableObject(p); }
    void openTableRow(const librevenge::RVNGPropertyList &p) override { generator.openTableRow(p); }
    void closeTableRow() override { generator.closeTableRow(); }
    void openTableCell(const librevenge::RVNGPropertyList &p) override { generator.openTableCell(p); }
    void closeTableCell() override { generator.closeTableCell(); }
    void insertCoveredTableCell(const librevenge::RVNGPropertyList &p) override { generator.insertCoveredTableCell(p); }
    void endTableObject() override { generator.endTableObject(); }
    void insertTab() override { generator.insertTab(); }
    void insertSpace() override { generator.insertSpace(); }
    void insertText(const librevenge::RVNGString &t) override { generator.insertText(t); }
    void insertLineBreak() override { generator.insertLineBreak(); }
    void insertField(const librevenge::RVNGPropertyList &p) override { generator.insertField(p); }
    void openOrderedListLevel(const librevenge::RVNGPropertyList &p) override { generator.openOrderedListLevel(p); }
    void openUnorderedListLevel(const librevenge::RVNGPropertyList &p) override { generator.openUnorderedListLevel(p); }
    void closeOrderedListLevel() override { generator.closeOrderedListLevel(); }
    void closeUnorderedListLevel() override { generator.closeUnorderedListLevel(); }
    void openListElement(const librevenge::RVNGPropertyList &p) override { generator.openListElement(p); }
    void closeListElement() override { generator.closeListElement(); }
    void defineParagraphStyle(const librevenge::RVNGPropertyList &p) override { generator.defineParagraphStyle(p); }
    void openParagraph(const librevenge::RVNGPropertyList &p) override { generator.openParagraph(p); }
    void closeParagraph() override { generator.closeParagraph(); }
    void defineCharacterStyle(const librevenge::RVNGPropertyList &p) override { generator.defineCharacterStyle(p); }
    void openSpan(const librevenge::RVNGPropertyList &p) override { generator.openSpan(p); }
    void closeSpan() override { generator.closeSpan(); }
    void openLink(const librevenge::RVNGPropertyList &p) override { generator.openLink(p); }
    void closeLink() override { generator.closeLink(); }
};

std::string generateDrawioXml(const std::vector<StencilItem> &items, int numCols = 3, double scale = 120.0) {
    std::ostringstream oss;
    oss << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    oss << "<mxfile host=\"app.diagrams.net\" modified=\"2026-08-24T00:00:00.000Z\" agent=\"visio2drawio\" version=\"21.1.2\" type=\"device\">\n";
    oss << "  <diagram id=\"visio-stencils\" name=\"Visio Stencils\">\n";
    oss << "    <mxGraphModel dx=\"1400\" dy=\"900\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"1\" pageScale=\"1\" pageWidth=\"3600\" pageHeight=\"5000\" math=\"0\" shadow=\"0\">\n";
    oss << "      <root>\n";
    oss << "        <mxCell id=\"0\" />\n";
    oss << "        <mxCell id=\"1\" parent=\"0\" />\n";

    double colWidth = 360.0;
    double startX = 40.0;
    double startY = 40.0;
    double paddingX = 40.0;
    double paddingY = 80.0;

    std::vector<double> colY(numCols, startY);

    for (size_t i = 0; i < items.size(); ++i) {
        const auto &item = items[i];
        
        int chosenCol = 0;
        double minY = colY[0];
        for (int c = 1; c < numCols; ++c) {
            if (colY[c] < minY) {
                minY = colY[c];
                chosenCol = c;
            }
        }

        double posX = startX + chosenCol * (colWidth + paddingX);
        double posY = colY[chosenCol];

        double w = item.widthInches * scale;
        double h = item.heightInches * scale;

        if (w <= 0.0) w = 100.0;
        if (h <= 0.0) h = 100.0;
        if (w > colWidth) {
            double ratio = colWidth / w;
            w = colWidth;
            h = h * ratio;
        }

        std::string base64Svg = base64_encode(item.svg);
        std::string escapedName = xmlEscape(item.name.empty() ? ("Shape " + std::to_string(i + 1)) : item.name);

        // Standard Draw.io format: image=data:image/svg+xml,<base64> without semicolon so mxGraph doesn't split style tokens
        std::string style = "shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;verticalAlign=top;aspect=fixed;imageAspect=0;image=data:image/svg+xml," + base64Svg + ";";

        oss << "        <mxCell id=\"shape-" << i + 2 << "\" value=\"" << escapedName << "\" style=\"" << style << "\" vertex=\"1\" parent=\"1\">\n";
        oss << "          <mxGeometry x=\"" << std::fixed << std::setprecision(2) << posX << "\" y=\"" << posY << "\" width=\"" << w << "\" height=\"" << h << "\" as=\"geometry\" />\n";
        oss << "        </mxCell>\n";

        colY[chosenCol] = posY + h + paddingY;
    }

    oss << "      </root>\n";
    oss << "    </mxGraphModel>\n";
    oss << "  </diagram>\n";
    oss << "</mxfile>\n";
    return oss.str();
}

std::string generateMxLibraryXml(const std::vector<StencilItem> &items, double scale = 120.0) {
    std::ostringstream jsonStream;
    jsonStream << "[";
    for (size_t i = 0; i < items.size(); ++i) {
        if (i > 0) jsonStream << ",";
        const auto &item = items[i];
        double w = std::round(item.widthInches * scale);
        double h = std::round(item.heightInches * scale);
        if (w <= 0) w = 100;
        if (h <= 0) h = 100;

        std::string title = item.name.empty() ? ("Shape " + std::to_string(i + 1)) : item.name;
        std::string base64Svg = base64_encode(item.svg);
        std::string dataUri = "data:image/svg+xml," + base64Svg;

        std::ostringstream xmlStream;
        xmlStream << "<mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/><mxCell id=\"2\" value=\""
                  << xmlEscape(title) << "\" style=\"shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;verticalAlign=top;aspect=fixed;imageAspect=0;image=data:image/svg+xml,"
                  << base64Svg << ";\" vertex=\"1\" parent=\"1\"><mxGeometry width=\"" << w << "\" height=\"" << h << "\" as=\"geometry\"/></mxCell></root></mxGraphModel>";

        jsonStream << "{\"title\":\"" << jsonEscape(title) << "\""
                   << ",\"w\":" << w
                   << ",\"h\":" << h
                   << ",\"aspect\":\"fixed\""
                   << ",\"data\":\"" << jsonEscape(dataUri) << "\""
                   << ",\"xml\":\"" << jsonEscape(xmlStream.str()) << "\"}";
    }
    jsonStream << "]";

    std::ostringstream oss;
    oss << "<mxlibrary>" << xmlEscape(jsonStream.str()) << "</mxlibrary>\n";
    return oss.str();
}

std::string generateJsonOutput(const std::vector<StencilItem> &items, int limit = 0) {
    size_t total = items.size();
    size_t outputCount = (limit > 0 && (size_t)limit < total) ? (size_t)limit : total;
    std::ostringstream oss;
    oss << "{\n";
    oss << "  \"total\": " << total << ",\n";
    oss << "  \"count\": " << outputCount << ",\n";
    oss << "  \"items\": [\n";
    for (size_t i = 0; i < outputCount; ++i) {
        if (i > 0) oss << ",\n";
        const auto &item = items[i];
        std::string title = item.name.empty() ? ("Shape " + std::to_string(i + 1)) : item.name;
        std::string base64Svg = base64_encode(item.svg);

        oss << "    {\n";
        oss << "      \"id\": " << (i + 1) << ",\n";
        oss << "      \"title\": \"" << jsonEscape(title) << "\",\n";
        oss << "      \"widthInches\": " << item.widthInches << ",\n";
        oss << "      \"heightInches\": " << item.heightInches << ",\n";
        oss << "      \"svgBase64\": \"data:image/svg+xml;base64," << base64Svg << "\"\n";
        oss << "    }";
    }
    oss << "\n  ]\n";
    oss << "}\n";
    return oss.str();
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        std::cout << "vss2drawio - Visio Stencil (.vss) to draw.io converter\n\n";
        std::cout << "Usage: vss2drawio <input_file> [output_file] [options]\n\n";
        std::cout << "Options:\n";
        std::cout << "  --format <drawio|mxlibrary|json>  Output format (default: drawio)\n";
        std::cout << "  --cols <number>                   Grid columns in diagram (default: 3)\n";
        std::cout << "  --scale <number>                  Points per inch scale (default: 120)\n";
        std::cout << "  --limit <number>                  Limit stencil count in JSON output (0 = all)\n";
        std::cout << "  -o <path>                         Output file path\n";
        return 0;
    }

    std::string inputFile = "";
    std::string outputFile = "";
    std::string format = "drawio";
    int numCols = 3;
    double scale = 120.0;
    int limit = 0;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--format" && i + 1 < argc) {
            format = argv[++i];
        } else if (arg == "--cols" && i + 1 < argc) {
            numCols = std::max(1, std::atoi(argv[++i]));
        } else if (arg == "--scale" && i + 1 < argc) {
            scale = std::max(10.0, std::atof(argv[++i]));
        } else if (arg == "--limit" && i + 1 < argc) {
            limit = std::max(0, std::atoi(argv[++i]));
        } else if (arg == "-o" && i + 1 < argc) {
            outputFile = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "vss2drawio - Visio Stencil (.vss) to draw.io converter\n\n";
            std::cout << "Usage: vss2drawio <input_file> [output_file] [options]\n\n";
            std::cout << "Options:\n";
            std::cout << "  --format <drawio|mxlibrary|json>  Output format (default: drawio)\n";
            std::cout << "  --cols <number>                   Grid columns in diagram (default: 3)\n";
            std::cout << "  --scale <number>                  Points per inch scale (default: 120)\n";
            std::cout << "  --limit <number>                  Limit stencil count in JSON output (0 = all)\n";
            std::cout << "  -o <path>                         Output file path\n";
            return 0;
        } else if (inputFile.empty() && arg[0] != '-') {
            inputFile = arg;
        } else if (outputFile.empty() && arg[0] != '-') {
            outputFile = arg;
        }
    }

    if (inputFile.empty()) {
        std::cerr << "Error: No input file specified.\n";
        return 1;
    }

    librevenge::RVNGFileStream input(inputFile.c_str());
    if (!libvisio::VisioDocument::isSupported(&input)) {
        std::cerr << "Error: Unsupported Visio file format: " << inputFile << "\n";
        return 2;
    }

    StencilDelegate delegate;
    bool success = libvisio::VisioDocument::parseStencils(&input, &delegate);
    if (!success || delegate.svgVector.empty()) {
        input.seek(0, librevenge::RVNG_SEEK_SET);
        success = libvisio::VisioDocument::parse(&input, &delegate);
    }

    if (!success || delegate.svgVector.empty()) {
        std::cerr << "Error: Failed to parse Visio document or no shapes found in: " << inputFile << "\n";
        return 3;
    }

    std::vector<StencilItem> items;
    for (size_t i = 0; i < delegate.svgVector.size(); ++i) {
        StencilItem item;
        item.name = (i < delegate.names.size()) ? delegate.names[i] : "";
        item.widthInches = (i < delegate.widths.size()) ? delegate.widths[i] : 1.0;
        item.heightInches = (i < delegate.heights.size()) ? delegate.heights[i] : 1.0;
        item.svg = delegate.svgVector[i].cstr();
        if (!item.svg.empty()) {
            items.push_back(item);
        }
    }

    std::string result;
    if (format == "mxlibrary") {
        result = generateMxLibraryXml(items, scale);
    } else if (format == "json") {
        result = generateJsonOutput(items, limit);
    } else {
        result = generateDrawioXml(items, numCols, scale);
    }

    if (!outputFile.empty()) {
        std::ofstream ofs(outputFile, std::ios::binary);
        if (!ofs) {
            std::cerr << "Error: Cannot open output file for writing: " << outputFile << "\n";
            return 4;
        }
        ofs << result;
        ofs.close();
        std::cout << "Successfully converted " << items.size() << " stencils to " << outputFile << " (" << format << ")\n";
    } else {
        std::cout << result;
    }

    return 0;
}
