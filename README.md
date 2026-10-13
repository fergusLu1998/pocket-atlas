Pocket Atlas

中文说明

软件目的

Pocket Atlas 是面向虚拟筛选结果复核的分子筛选与蛋白配体互作分析工作台。程序将结构相似性、化学骨架、已有对接评分、MM/GBSA 数值、三维结合姿态和人工候选记录组织在同一分析项目中。其用途是支持候选缩减和结构证据复核，计算输出不构成结合活性或亚型选择性的实验验证。

数据与分析方法

程序支持 SMILES、CSV、TSV、SMI、SDF、MAE 和 MAEGZ 数据，也可单独载入 PDB 受体。输入保留原始编号、结构记录及已有评分；无效结构、重复记录和缺失评分分别报告。分子结构由 RDKit 解析，描述符包括分子量、cLogP 和极性表面积。新项目默认采用 Murcko 骨架、Morgan 半径 2、2048 位指纹与 Tanimoto 相似度阈值 0.60。参数可修改，已保存项目恢复其原有设置。

聚类采用动态 Butina 方法。骨架模式先分析唯一骨架，再将簇成员关系映射至分子。同一簇内成员与选定中心满足阈值，但任意成员对不保证具有相同相似度。无环分子使用完整连接结构。共同核心经成员子结构匹配复核，固定侧链保留，变化位点以 R 编号表示。不能统一的核心按骨架子系列展示。

化学空间和聚类分簇提供二维及三维 FastMap 投影。三维视图可旋转，二维和三维投影视图均支持框选放大、滚轮缩放、分子点选和框选筛选。投影以原始指纹距离生成，仅用于导航。相同骨架可能共享投影坐标，点击重叠点后可在列表中逐个查看分子。簇轮廓是投影中成员的包络，不表示独立计算的相似性边界。评分分布展示 Docking 与 MM/GBSA 两个独立数值，不合并为综合评分。

蛋白配体互作

浏览器可直接阅览受支持的 MAEGZ 结构，并提供口袋表面、残基标签定位、原子距离、互作明细和序列比对。受体和配体必须处于同一坐标系；仅含配体的文件需要补充受体。单点突变界面用于记录替换方案并检查局部互作与保守性，不进行侧链重建、自由能预测或突变效应验证。

开源互作方法 Pocket Atlas Open Geometry 在浏览器工作线程中执行，无需 Schrödinger。程序按原子距离、键拓扑、形式电荷和芳香环方向识别氢键、卤键、盐桥、芳香环堆积及阳离子与芳香环近接。判定标准在互作结果中记录。氢键要求供体受体距离不超过 3.5 Å、氢受体距离不超过 2.6 Å、供体氢受体夹角不小于 120 度；缺少供体氢时仅报告候选近接。盐桥采用带相反电荷的重原子距离不超过 4.0 Å 的规则。卤键要求 C-X-A 夹角不小于 150 度，Cl、Br 和 I 的距离限值分别为 3.5、3.7 和 4.0 Å。芳香环和阳离子相关判据见输出中的 distanceType。

该方法使用近似化学类型，不执行质子化、能量优化或溶剂处理。缺失氢、电荷或键拓扑造成的信息不足保留为未确定，未确认的氢键候选不进入具有互作的筛选结果。它不是 Schrödinger 原生互作算法的复现。原生模式仍需使用者自行安装并授权 Schrödinger；两类结果使用独立缓存，方法切换会同步改变互作视图和筛选依据。

项目管理与结果输出

项目包含分析参数、分子数据、受体和姿态、互作缓存、候选选择及备注。项目目录由使用者授权，程序检索其中的 JSON 项目。浏览器缓存与项目文件分别管理，项目每 30 分钟自动保存，关闭项目及离开页面前提示未保存修改。候选规模可自定义，跨页选择保留，每页可显示 20、50 或 100 条。列表支持 cLogP 与已有评分排序，也可按前 N 条记录限定分析范围。结构图导出为 PNG 或 PDF，包含分子编号、分子量及 MM/GBSA；簇骨架总览支持相同格式。

运行与再现

公开工作台地址为 https://pocket-atlas.ferguslu.chatgpt.site/ ，源码地址为 https://github.com/fergusLu1998/pocket-atlas 。网站不提供共享研究项目库，浏览器中的研究数据由各使用者管理。

比赛发行包同时提供源文件和已构建的独立网页。完整解压后运行 Start Pocket Atlas.cmd。Windows PowerShell 启动仅监听本机的静态服务，无需安装 Node.js 或 npm，浏览器资源不从网络下载。首次使用可选择 Schrödinger 安装目录，也可跳过并使用浏览器分析。运行期间保留启动窗口，关闭窗口可结束本次网页服务。源文件按提交要求平铺，启动器按路径清单恢复目录；RDKit WASM 以文本形式随包保存并在本机恢复。

从源码重新构建需要 Node.js 22.13 或更高版本和 npm。在项目目录依次执行 npm ci、npm run build:standalone，再执行 powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/serve_standalone.ps1。源码开发使用 npm run dev。功能测试、类型检查及代码规范检查分别执行 npm test、npm run typecheck 和 npm run lint。第三方压缩资源不参与应用源码的规范检查；React Compiler 未在本项目中启用，其专属规则不用于判定编译有效性。第三方组件的包装类型和三维接口采用与适配用途相符的规则范围。

使用范围与限制

评分必须来自可比较的计算流程；不同对接设置的评分不能直接解释为相对活性。输入坐标、结构电荷、立体化学和受体选择需要人工复核。FastMap 可压缩和扭曲高维距离，几何互作与突变设计均需结合实验验证。当前软件版本为 1.0.1，具体源码状态与本次验收范围在发行包的 source-map.json 和 VERIFICATION.txt 中记录。第三方软件及许可证见 THIRD_PARTY_NOTICES.md。

English documentation

Purpose and analytical methods

Pocket Atlas is a workbench for reviewing virtual-screening results and prioritizing compounds. Molecular similarity, scaffolds, existing docking and MM/GBSA scores, three-dimensional poses, and manual selection records are maintained within one project. Computational outputs support structural review and do not establish binding activity or subtype selectivity.

Supported inputs include SMILES, CSV, TSV, SMI, SDF, MAE, MAEGZ, and separate PDB receptors. RDKit provides structure parsing, depictions, fingerprints, and molecular descriptors. New projects use Murcko scaffolds, Morgan radius 2, 2048-bit fingerprints, and a Tanimoto threshold of 0.60. Saved projects retain their own parameters. Dynamic Butina clustering ensures the threshold between a selected center and its members, rather than between every member pair. In scaffold mode, unique scaffolds are clustered and memberships are mapped back to molecules. Acyclic structures use their full connectivity. Common cores are checked against members; variable substituents are represented by R labels, and incompatible cores are displayed as subseries.

Two-dimensional and three-dimensional FastMap plots support box zoom, wheel zoom, point selection, and region filtering. Three-dimensional views support rotation. Overlapping points expose a compound selection list. Cluster envelopes describe the projected members and are not similarity boundaries. Projected distances serve navigation and do not replace fingerprint similarity. Docking and MM/GBSA remain separate scoring dimensions.

Interaction analysis

The browser reads supported MAEGZ structures and displays poses, pocket surfaces, residue labels, atom distances, interaction details, and sequence alignments. Receptors and ligands must share a coordinate frame. The mutation interface records single-residue substitution proposals and supporting interactions; it does not rebuild side chains or predict mutation free energies.

Pocket Atlas Open Geometry runs in a browser worker without Schrodinger. Distance, bonding, formal charge, and aromatic-ring geometry are used to identify hydrogen bonds, halogen bonds, salt bridges, aromatic stacking, and cation-pi contacts. Hydrogen bonds require a donor-acceptor distance of at most 3.5 Å, a hydrogen-acceptor distance of at most 2.6 Å, and a donor-hydrogen-acceptor angle of at least 120 degrees. Missing donor hydrogens produce unconfirmed candidates. Salt bridges use oppositely charged heavy atoms within 4.0 Å. Halogen contacts require a C-X-A angle of at least 150 degrees, with Cl, Br, and I distance limits of 3.5, 3.7, and 4.0 Å, respectively. Ring criteria are recorded in each result's distanceType field.

Chemical typing is approximate. No protonation, minimization, or solvent treatment is performed. Insufficient hydrogen, charge, or topology information yields unknown results where applicable; unconfirmed hydrogen-bond candidates do not satisfy positive interaction filters. This open method does not reproduce Schrodinger-native algorithms. Native calculations remain optional and require a separately licensed installation. Native and open results use separate caches, and switching methods updates both display and filtering.

Operation and reproducibility

Projects retain data, analysis settings, poses, interaction caches, selections, and notes. Local project files and browser caches are managed separately. Autosaving occurs every 30 minutes, and unsaved changes trigger prompts before project closure or navigation. Candidate counts are configurable, page sizes are 20, 50, or 100, and selections survive pagination. Lists support cLogP and score sorting, top-N analysis, and residue-interaction filtering. Candidate structure sheets and scaffold overviews export as PNG or PDF.

The competition distribution includes source files and a prebuilt standalone web application. Extract all files and run Start Pocket Atlas.cmd on Windows. PowerShell serves the bundled application only on the local machine. Runtime use requires neither Node.js nor npm, and no web resources are downloaded. Schrodinger configuration is optional. Keep the launch window open while using the application. Flattened source paths and the bundled text-encoded RDKit runtime are restored locally according to the path manifest.

Rebuilding from source requires Node.js 22.13 or later and npm. Run npm ci and npm run build:standalone, then powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/serve_standalone.ps1. Development uses npm run dev. Verification commands are npm test, npm run typecheck, and npm run lint. Vendor minified resources are excluded from application linting. React Compiler is not enabled, and compiler-specific rules are therefore excluded. Scope adjustments for external adapters are distinct from functional and type checks.

Limitations

Scores require compatible upstream methods and cannot be interpreted directly as experimental activity. Coordinates, charges, stereochemistry, and receptor choice require review. FastMap distorts high-dimensional distances, and geometric interactions and mutation proposals require experimental validation. Version 1.0.1 identifies the software release; source-map.json and VERIFICATION.txt specify the distributed source state and verification scope. Third-party licenses are documented in THIRD_PARTY_NOTICES.md.
