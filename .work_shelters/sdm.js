class StdDownloadManager {

    constructor() {
        this.isDownloadBtnClicked = false;

        this.url = {
            "xlsColList": `/download/columList.json?pk=${$("#publicDataPk").val()}`,
            "xlsData": `/download/standard.json?publicDataPk=${$("#publicDataPk").val()}`
        };

        this.downloadType = {
            "XLS": "xls",
            "CSV": "csv",
            "JSON": "json",
            "XML": "xml",
            "RDF": "rdf"
        };

        this.initEvents();
    }

    initEvents() {
        let self = this;

        $("#stdXlsDownloadBtn").on("click", function () {
            if (self.isDownloadBtnClicked) {
                alert("다운로드 진행중입니다. 잠시만 기다려주세요.");
                return;
            }
            self.downloadXls();
        });

        $("#stdCsvDownloadBtn").on("click", function () {
            if (self.isDownloadBtnClicked) {
                alert("다운로드 진행중입니다. 잠시만 기다려주세요.");
                return;
            }
            self.downloadCsv();
        });

        $("#stdJsonDownloadBtn").on("click", function () {
            if (self.isDownloadBtnClicked) {
                alert("다운로드 진행중입니다. 잠시만 기다려주세요.");
                return;
            }
            self.downloadJson();
        });

        $("#stdXmlDownloadBtn").on("click", function () {
            if (self.isDownloadBtnClicked) {
                alert("다운로드 진행중입니다. 잠시만 기다려주세요.");
                return;
            }
            self.downloadXml();
        });

        $("#stdRdfDownloadBtn").on("click", function () {
            if (self.isDownloadBtnClicked) {
                alert("다운로드 진행중입니다. 잠시만 기다려주세요.");
                return;
            }
            self.downloadRdf();
        });
    }

    async downloadXls() {
        let self = this;
        this.isDownloadBtnClicked = true;

        try {
            let header = await self.getHeader(self.downloadType.XLS.toUpperCase());
            let dataParam = self.preProcessDataParam(header);
            let dataInfo = self.preProcessDataInfo(header);

            let outFile = await self.generateXls(dataParam, dataInfo);

            let xls = XLSX.write(outFile, {bookType: 'biff8', type: 'binary'});

            const blob = new Blob([self.toBinaryBufferForXls(xls)], {type: "application/vnd.ms-excel"});
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${dataInfo.fileName}-${moment().format("YYYYMMDD")}.${self.downloadType.XLS}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (e) {
            console.log(e);
            alert("다운로드에 실패하였습니다. 잠시후 시도해 주세요.");
        } finally {
            self.isDownloadBtnClicked = false;
        }
    }

    async downloadCsv() {
        let self = this;
        this.isDownloadBtnClicked = true;

        try {
            let header = await self.getHeader(self.downloadType.CSV.toUpperCase());
            let dataParam = self.preProcessDataParam(header);
            let dataInfo = self.preProcessDataInfo(header);

            let csv = await self.generateCsv(dataParam, dataInfo);

            const eucKrCsv = iconv.encode(csv, 'EUC-KR');
            const blob = new Blob([eucKrCsv], {type: "text/csv;charset=EUC-KR;"});
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${dataInfo.fileName}.${self.downloadType.CSV}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (e) {
            console.log(e);
            alert("다운로드에 실패하였습니다. 잠시후 시도해 주세요.");
        } finally {
            self.isDownloadBtnClicked = false;
        }
    }


    async downloadJson() {
        let self = this;
        this.isDownloadBtnClicked = true;
        let object = {
            "fields": [],
            "records": []
        };

        try {
            let header = await self.getHeader(self.downloadType.JSON.toUpperCase());
            let dataParam = self.preProcessDataParam(header);
            let dataInfo = self.preProcessDataInfo(header);

            const fields = self.generateJsonFields(dataInfo);
            const records = await self.generateJsonRecords(dataParam, dataInfo);

            object.fields = fields;
            object.records = records;

            const jsonString = JSON.stringify(object);

            const blob = new Blob([jsonString], {type: "application/json"});

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${dataInfo.fileName}.${this.downloadType.JSON}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (e) {
            console.log(e);
            alert("다운로드에 실패하였습니다. 잠시후 시도해 주세요.");
        } finally {
            self.isDownloadBtnClicked = false;
        }
    }

    async downloadXml() {
        let self = this;
        this.isDownloadBtnClicked = true;

        try {
            let header = await self.getHeader(self.downloadType.XML.toUpperCase());
            let dataParam = self.preProcessDataParam(header);
            let dataInfo = self.preProcessDataInfo(header);

            const xml = await self.generateXml(dataParam, dataInfo, false);

            const blob = new Blob([xml], {type: 'application/xml'});

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${dataInfo.fileName}.${this.downloadType.XML}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (e) {
            console.log(e);
            alert("다운로드에 실패하였습니다. 잠시후 시도해 주세요.");
        } finally {
            self.isDownloadBtnClicked = false;
        }
    }

    async downloadRdf() {
        let self = this;
        this.isDownloadBtnClicked = true;

        try {
            let header = await self.getHeader(self.downloadType.RDF.toUpperCase());
            let dataParam = self.preProcessDataParam(header);
            let dataInfo = self.preProcessDataInfo(header);

            const rdf = await self.generateXml(dataParam, dataInfo, true);

            const blob = new Blob([rdf], {type: 'application/xml'});

            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${dataInfo.fileName}.${this.downloadType.RDF}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (e) {
            console.log(e);
            alert("다운로드에 실패하였습니다. 잠시후 시도해 주세요.");
        } finally {
            self.isDownloadBtnClicked = false;
        }
    }

    async generateXls(dataParam, dataInfo) {
        let self = this;
        const callCount = Math.ceil(dataParam.totalCount / dataParam.perPage);
        if (callCount < 0) {
            throw new Error("call count is zero");
            return;
        }

        let excelData = [];
        excelData.push(dataInfo.headerKr);

        for (let cnt = 1; cnt <= callCount; cnt++) {
            dataParam.page = cnt;
            try {
                const results = await self.getData(dataParam);
                for (const result of results) {
                    let excelRow = [];
                    for (const headerEn of dataInfo.headerEn) {
                        let cellValue = result[headerEn] === null ? "null" : result[headerEn];
                        excelRow.push(cellValue);
                    }
                    excelData.push(excelRow);
                }

            } catch (e) {
                console.log(e);
                throw new Error(`${self.downloadType.XLS} data parsing error`);
                return;
            }
        }

        const workBook = XLSX.utils.book_new();
        const workBookSheet = XLSX.utils.aoa_to_sheet(excelData, {origin: {r: 1, c: 0}});//첫번째 행 띄움


        XLSX.utils.book_append_sheet(workBook, workBookSheet, "Sheet1");

        return workBook;
    }

    async generateCsv(dataParam, dataInfo) {
        let self = this;
        const callCount = Math.ceil(dataParam.totalCount / dataParam.perPage);
        if (callCount < 0) {
            throw new Error("call count is zero");
            return;
        }

        let csvData = [];
        csvData.push(dataInfo.headerKr);

        for (let cnt = 1; cnt <= callCount; cnt++) {
            dataParam.page = cnt;
            try {
                const results = await self.getData(dataParam);
                for (const result of results) {
                    let csvRow = [];
                    for (const headerEn of dataInfo.headerEn) {
                        let csvDatum = result[headerEn] ?? '';
                        if (csvDatum && typeof csvDatum == "string" && csvDatum.includes(',') && !csvDatum.includes('"')) {
                            csvDatum = `"${csvDatum}"`;
                        }

                        csvRow.push(csvDatum);
                    }
                    csvData.push(csvRow);
                }

            } catch (e) {
                console.log(e);
                throw new Error(`${self.downloadType.CSV} data parsing error`);
                return;
            }
        }

        return csvData.map(row => row.join(",")).join("\n");
    }

    generateJsonFields(dataInfo) {
        let fields = [];
        for (const headerKr of dataInfo.headerKr) {
            const object = {"id": headerKr};
            fields.push(object);
        }
        return fields;
    }

    async generateJsonRecords(dataParam, dataInfo) {
        let self = this;
        const callCount = Math.ceil(dataParam.totalCount / dataParam.perPage);
        if (callCount < 0) {
            throw new Error("call count is zero");
            return;
        }

        let records = [];

        for (let cnt = 1; cnt <= callCount; cnt++) {
            dataParam.page = cnt;
            try {
                const results = await self.getData(dataParam);
                for (const result of results) {
                    let record = {};
                    let iter = 0;
                    for (const headerEn of dataInfo.headerEn) {
                        let value = result[headerEn];

                        if (value !== null && value !== undefined && typeof value == "string") {
                            value = value.replaceAll("\"", "");
                            record[dataInfo.headerKr[iter]] = value;
                        }

                        iter++;
                    }
                    records.push(record);
                }

            } catch (e) {
                console.log(e);
                throw new Error(`json data parsing error`);
                return;
            }
        }
        return records;
    }

    async generateXml(dataParam, dataInfo, isRdf) {
        let self = this;
        const callCount = Math.ceil(dataParam.totalCount / dataParam.perPage);
        if (callCount < 0) {
            throw new Error("call count is zero");
            return;
        }
        const {create} = xmlbuilder2;
        const rootElementName = isRdf ? "rdf:dataGrid" : "dataGrid";
        const root = create({version: '1.0', encoding: 'UTF-8', standalone: true}).ele(rootElementName);

        const recordsElementName = isRdf ? "rdf:records" : "records";
        const records = root.ele(recordsElementName);


        for (let cnt = 1; cnt <= callCount; cnt++) {
            dataParam.page = cnt;
            try {
                const results = await self.getData(dataParam);
                for (const result of results) {
                    const recordElementName = isRdf ? "rdf:record" : "record";
                    let record = records.ele(recordElementName);
                    let iter = 0;
                    for (const headerEn of dataInfo.headerEn) {
                        let elementName = dataInfo.headerKr[iter];

                        if (elementName) {
                            elementName = elementName.replaceAll("<", "&lt;")
                                .replaceAll(">", "&gt;")
                                .replaceAll("&", "&amp;")
                                .replaceAll("(", "")
                                .replaceAll(")", "")
                                .replaceAll("\"", "")
                                .replaceAll("`", "_")
                                .replaceAll("~", "_")
                                .replaceAll("!", "_")
                                .replaceAll("@", "_")
                                .replaceAll("#", "_")
                                .replaceAll("$", "_")
                                .replaceAll("%", "_")
                                .replaceAll("^", "_")
                                .replaceAll("&", "_")
                                .replaceAll("*", "_")
                                .replaceAll(" ", "_")
                                .replaceAll("/", "_");
                            if (elementName.charAt(0) >= '0' && elementName.charAt(0) <= '9') {
                                elementName = '_' + elementName;
                            }
                        }

                        let elementValue = result[headerEn] ?? "";
                        if (elementValue && typeof elementValue == "string") {
                            elementValue = elementValue.replaceAll("\"", "")
                                .replaceAll("<", "&lt;")
                                .replaceAll(">", "&gt;")
                                .replaceAll("&", "&amp;");
                        }
                        record.ele(elementName).txt(elementValue);
                        iter++;
                    }
                }

            } catch (e) {
                console.log(e);
                throw new Error(`xml data parsing error`);
                return;
            }
        }
        const xml = root.end({prettyPrint: false});
        return xml;
    }

    getHeader(ext) {
        let self = this;
        let url = self.url.xlsColList + `&ext=${ext}`;

        const $recommendDataYn = $('input[name="recommendDataYn"]');

        if ($recommendDataYn.length > 0) {
            const recommendDataYn = $recommendDataYn.val();
            if (recommendDataYn) {
                url += `&recommendDataYn=${recommendDataYn}`;
            }
        }

        return $.ajax({
            type: "GET",
            url: url,
            dataType: "json"
        });
    }

    preProcessDataParam(header) {
        return {
            "colNmList": header.tableVO.colNmList,
            "totalCount": header.totalCount,
            "svcTableNm": header.tableVO.svcTableNm,
            "perPage": 10000,
            "page": 0
        };
    }

    preProcessDataInfo(header) {
        return {
            "headerKr": header.columList.map(item => item.columNm),
            "headerEn": header.columList.map(item => item.columCode),
            "fileName": header.fileName
        };
    }

    getData(param) {
        let self = this;
        return $.ajax({
            type: "GET",
            traditional: true,
            url: self.url.xlsData,
            data: {...param},
            dataType: "json"
        });
    }

    toBinaryBufferForXls(s) {
        const buffer = new ArrayBuffer(s.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < s.length; i++) {
            view[i] = s.charCodeAt(i) & 0xFF;
        }
        return buffer;
    }
}