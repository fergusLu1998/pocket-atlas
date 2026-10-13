Pocket Atlas 软件验证记录

验证目的与范围

本次验证针对分子分布交互、聚类降维展示、浏览器互作计算和独立发行方式。输入包括程序提供的演示库、合成分子压力测试及含已知几何关系的合成蛋白配体坐标。合成坐标用于软件回归，不代表实际蛋白中的结合模式。具体发行源码提交在 source-map.json 中记录。

分析计算验证

分子解析、无效记录处理、重复结构保留、评分缺失值与零值、cLogP 排序、Butina 成员归属、前 N 条分析、候选跨页选择、项目目录读写、结构图分页输出、共同核心匹配和 R 位点表达通过自动化回归测试。2604 条合成记录的压力测试覆盖 3389106 个分子对。二维及三维 FastMap 坐标经有限值检查，前两个维度继续使用原有距离投影方法。

图形交互验证

在独立浏览器构建中实际执行鼠标框选、散点点选及三维拖动。框选放大后坐标范围缩小，39 条演示分子的列表范围未改变。相同骨架坐标处显示五个分子的选择列表，选择 DEMO-025 后详情切换至对应记录。评分散点可切换至 DEMO-023，三维拖动改变两个旋转角度。框选筛选与框选放大为独立操作。浏览器截图接口在本次环境中不可用，因此图形验证依据真实输入后的界面状态和绘图坐标范围，不作为逐像素视觉检查。

互作方法验证

开源几何算法使用合成坐标验证显式氢的氢键角度、缺氢候选、盐桥距离、卤键方向、芳香环堆积和阳离子芳香环近接。缺氢候选不会满足正向互作筛选，相关负结果保留为未确定。两种计算方法的缓存编号经独立性检查。浏览器中载入两个合成配体与一个合成受体，针对 A:ARG609 的盐桥筛选得到有互作一条、无互作一条、未确定零条，候选列表同步保留一条。此验证未比较开源几何结果与 Schrödinger 原生算法的数值一致性。

运行环境与质量检查

功能测试、TypeScript 类型检查和配置后的代码规范检查通过。第三方 RDKit 和 3Dmol 压缩资源不参与应用规范检查。React Compiler 未启用，其专属规则不作为本软件的编译条件；外部适配类型和组件包装按实际用途限定规则范围。源码中控件关联、回调依赖、文件名字符串处理及排序写法已修正。独立发行构建包含浏览器运行资源，以 Windows PowerShell 提供本机静态服务，运行时不执行 npm 安装。开发及重新构建仍需要 Node.js 与锁定依赖。

解释边界

开源互作为带有近似化学类型的几何结果，不执行质子化、能量最小化或溶剂计算。原生互作需要另行安装和授权 Schrödinger，本次未执行新的许可环境验证。突变界面不预测自由能或实验效应。降维和几何测试不能替代真实数据的结构质量复核及实验验证。

English verification record

Regression inputs comprised the demonstration library, synthetic load-test molecules, and protein-ligand coordinates with specified geometric relationships. Automated tests covered parsing, clustering, descriptors, ranking, persistent selections, project files, structure exports, common cores, and R sites. Plot tests covered reversible coordinate transforms, bounded box zoom, overlapping points, and three-dimensional rotation.

Actual browser inputs confirmed box zoom without list filtering, selection among five overlapping compounds, score-point navigation, and rotation. A synthetic A:ARG609 salt-bridge filter returned one positive and one negative compound and retained the positive compound in the table. The screenshot interface was unavailable; no pixel-level visual inspection is claimed.

Open Geometry tests covered explicit-hydrogen bonds, unconfirmed missing-hydrogen candidates, salt bridges, directional halogen contacts, aromatic stacking, cation-pi contacts, and separate cache identities. Functional tests, type checking, and the scoped lint configuration passed. Schrodinger-native equivalence, a new licensed-engine verification, experimental binding effects, and mutation free energies were outside this verification scope.
