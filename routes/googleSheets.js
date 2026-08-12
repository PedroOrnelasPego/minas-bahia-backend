// routes/googleSheets.js
import express from "express";
import { google } from "googleapis";
import { listarDiretorioPublico } from "../services/cosmos.js";
import {
  getCordaNomeComSubclasse,
  getProximaCordaNomeComSubclasse,
  getCordaSubclasse,
} from "../constants/nomesCordasBackend.js";

const router = express.Router();

function getGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : null;

  if (email && privateKey) {
    return new google.auth.JWT({
      email,
      key: privateKey,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
      ],
    });
  }
  return null;
}

/**
 * @swagger
 * /perfil/planilha-alunos:
 *   post:
 *     summary: Cria a planilha de conferência diretamente no Google Drive via API do Google Sheets
 *     tags: [Google Sheets]
 */
router.post("/planilha-alunos", async (req, res) => {
  try {
    const { quadranteFilter = "todos", categoriaFilter = "todos", pesquisa = "" } = req.body || {};

    let integrantes = await listarDiretorioPublico();
    integrantes = (integrantes || []).filter((u) => u.nome && u.nome.trim().length > 0);

    const alunosFiltrados = integrantes.filter((u) => {
      if (quadranteFilter !== "todos") {
        const loc = (u.localTreino || "").toLowerCase();
        if (!loc.includes(quadranteFilter.toLowerCase())) return false;
      }
      if (categoriaFilter !== "todos") {
        const sub = getCordaSubclasse(u.corda).toLowerCase();
        if (sub !== categoriaFilter.toLowerCase()) return false;
      }
      if (pesquisa.trim()) {
        const q = pesquisa.toLowerCase();
        const nome = (u.nome || "").toLowerCase();
        const apelido = (u.apelido || "").toLowerCase();
        if (!nome.includes(q) && !apelido.includes(q)) return false;
      }
      return true;
    });

    if (alunosFiltrados.length === 0) {
      return res.status(400).json({ erro: "Nenhum aluno encontrado para os filtros selecionados." });
    }

    const auth = getGoogleAuth();

    if (!auth) {
      return res.status(503).json({
        erro: "Service Account do Google não configurada no servidor (.env).",
        precisaConfiguracao: true,
      });
    }

    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });

    const dataHoje = new Date().toISOString().slice(0, 10);
    const title = `Conferência de Alunos - ${quadranteFilter} - ${categoriaFilter} (${dataHoje})`;

    const createRes = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [
          {
            properties: {
              sheetId: 0,
              title: "Conferência Alunos",
              gridProperties: {
                rowCount: alunosFiltrados.length + 10,
                columnCount: 10,
              },
            },
          },
        ],
      },
    });

    const spreadsheetId = createRes.data.spreadsheetId;

    const values = [
      ["Nome", "Apelido", "Corda Atual", "Próxima Corda", "Conferência do Aluno", ""],
      ["", "", "", "", "Esta tudo certo!", "Meus dados estão errados!"],
    ];

    alunosFiltrados.forEach((u) => {
      values.push([
        u.nome || "-",
        u.apelido || "-",
        getCordaNomeComSubclasse(u.corda),
        getProximaCordaNomeComSubclasse(u.corda),
        "",
        "",
      ]);
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'Conferência Alunos'!A1:F" + values.length,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    const batchRequests = [
      {
        mergeCells: {
          range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 },
          mergeType: "MERGE_ALL",
        },
      },
      {
        mergeCells: {
          range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 },
          mergeType: "MERGE_ALL",
        },
      },
      {
        mergeCells: {
          range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 2, endColumnIndex: 3 },
          mergeType: "MERGE_ALL",
        },
      },
      {
        mergeCells: {
          range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 3, endColumnIndex: 4 },
          mergeType: "MERGE_ALL",
        },
      },
      {
        mergeCells: {
          range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 4, endColumnIndex: 6 },
          mergeType: "MERGE_ALL",
        },
      },

      // Validação de Dados: BOOLEAN com showCustomUi: true (Caixa de Seleção) nas Colunas E e F
      {
        setDataValidation: {
          range: {
            sheetId: 0,
            startRowIndex: 2,
            startColumnIndex: 4,
            endColumnIndex: 6,
          },
          rule: {
            condition: {
              type: "BOOLEAN",
            },
            showCustomUi: true,
            strict: true,
          },
        },
      },

      // Formatação Condicional Laranja: Ambas marcadas
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [
              {
                sheetId: 0,
                startRowIndex: 2,
                startColumnIndex: 0,
                endColumnIndex: 6,
              },
            ],
            booleanRule: {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [{ userEnteredValue: "=AND($E3=TRUE, $F3=TRUE)" }],
              },
              format: {
                backgroundColor: { red: 0.98, green: 0.73, blue: 0.01 },
              },
            },
          },
          index: 0,
        },
      },

      // Formatação Condicional Verde: Esta tudo certo!
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [
              {
                sheetId: 0,
                startRowIndex: 2,
                startColumnIndex: 0,
                endColumnIndex: 6,
              },
            ],
            booleanRule: {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [{ userEnteredValue: "=$E3=TRUE" }],
              },
              format: {
                backgroundColor: { red: 0.71, green: 0.90, blue: 0.71 },
              },
            },
          },
          index: 1,
        },
      },

      // Formatação Condicional Vermelho: Meus dados estão errados!
      {
        addConditionalFormatRule: {
          rule: {
            ranges: [
              {
                sheetId: 0,
                startRowIndex: 2,
                startColumnIndex: 0,
                endColumnIndex: 6,
              },
            ],
            booleanRule: {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [{ userEnteredValue: "=$F3=TRUE" }],
              },
              format: {
                backgroundColor: { red: 0.95, green: 0.50, blue: 0.50 },
              },
            },
          },
          index: 2,
        },
      },
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: batchRequests },
    });

    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: {
          role: "writer",
          type: "anyone",
        },
      });
    } catch (permErr) {
      console.warn("Aviso ao liberar permissão pública:", permErr?.message);
    }

    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    res.json({ url, spreadsheetId });
  } catch (err) {
    console.error("Erro ao criar planilha via Google API:", err);
    res.status(500).json({ erro: "Erro ao criar planilha no Google Drive." });
  }
});

export default router;
