// UI Toolkit 域语义用例（由 capability-semantics.mjs 拼进 Harness.Main）。
//
// 覆盖 4 项能力：unity.uitk.uxml / unity.uitk.uss / unity.uitk.panel_settings / unity.uitk.document。
// 每项至少「主路径 + 参数/缺失错误路径」；UXML/USS 额外覆盖路径越界与 sha256 并发写。
//
// 注意：离线 stub 的 AssetDatabase.LoadAssetAtPath<T> 恒返回 default，因此 validate 的主路径
// 只能断言「显式错误列表」（valid=false + errors 非空），真正的 valid=true 需要真机验证。
export default String.raw`
        // ===== UI Toolkit 域：UXML / USS / PanelSettings / UIDocument =====

        // ---- UXML（文本资产 + 正则 query）----
        var uitkRichUxml = "<ui:UXML xmlns:ui=\"UnityEngine.UIElements\">\n    <ui:VisualElement name=\"root\" class=\"root\">\n        <ui:Label name=\"title\" class=\"h1 btn\" text=\"Hello\" />\n        <ui:Button name=\"ok\" class=\"btn primary\" text=\"OK\" />\n    </ui:VisualElement>\n</ui:UXML>\n";
        Run(results, "uitk.uxml-create", "unity.uitk.uxml",
            Args(new object[] { "action", "create", "path", "Assets/UI/Test.uxml", "content", uitkRichUxml }));
        Run(results, "uitk.uxml-read", "unity.uitk.uxml",
            Args(new object[] { "action", "read", "path", "Assets/UI/Test.uxml" }));
        Run(results, "uitk.uxml-query", "unity.uitk.uxml",
            Args(new object[] { "action", "query", "path", "Assets/UI/Test.uxml" }));
        Run(results, "uitk.uxml-validate", "unity.uitk.uxml",
            Args(new object[] { "action", "validate", "path", "Assets/UI/Test.uxml" }));
        Run(results, "uitk.uxml-validate-missing", "unity.uitk.uxml",
            Args(new object[] { "action", "validate", "path", "Assets/UI/Nope.uxml" }));
        Run(results, "uitk.uxml-create-default", "unity.uitk.uxml",
            Args(new object[] { "action", "create", "path", "Assets/UI/Default.uxml" }));
        Run(results, "uitk.uxml-query-default", "unity.uitk.uxml",
            Args(new object[] { "action", "query", "path", "Assets/UI/Default.uxml" }));
        Run(results, "uitk.uxml-write-sha-mismatch", "unity.uitk.uxml",
            Args(new object[] { "action", "write", "path", "Assets/UI/Test.uxml",
                "content", "<ui:UXML xmlns:ui=\"UnityEngine.UIElements\" />", "sha256", "deadbeef" }));
        Run(results, "uitk.uxml-write", "unity.uitk.uxml",
            Args(new object[] { "action", "write", "path", "Assets/UI/Test.uxml",
                "content", "<ui:UXML xmlns:ui=\"UnityEngine.UIElements\"><ui:VisualElement name=\"root2\" /></ui:UXML>" }));
        Run(results, "uitk.uxml-read-after-write", "unity.uitk.uxml",
            Args(new object[] { "action", "read", "path", "Assets/UI/Test.uxml" }));
        Run(results, "uitk.uxml-create-exists", "unity.uitk.uxml",
            Args(new object[] { "action", "create", "path", "Assets/UI/Test.uxml", "content", "<ui:UXML />" }));
        Run(results, "uitk.uxml-read-missing", "unity.uitk.uxml",
            Args(new object[] { "action", "read", "path", "Assets/UI/Missing.uxml" }));
        Run(results, "uitk.uxml-absolute-path", "unity.uitk.uxml",
            Args(new object[] { "action", "create", "path", "/tmp/uitk-evil.uxml", "content", "<ui:UXML />" }));
        Run(results, "uitk.uxml-parent-escape", "unity.uitk.uxml",
            Args(new object[] { "action", "create", "path", "Assets/../uitk-evil.uxml", "content", "<ui:UXML />" }));
        Run(results, "uitk.uxml-outside-assets", "unity.uitk.uxml",
            Args(new object[] { "action", "create", "path", "Packages/Uitk.uxml", "content", "<ui:UXML />" }));
        Run(results, "uitk.uxml-bad-extension", "unity.uitk.uxml",
            Args(new object[] { "action", "create", "path", "Assets/UI/NotUxml.txt", "content", "x" }));
        Run(results, "uitk.uxml-missing-path", "unity.uitk.uxml",
            Args(new object[] { "action", "create" }));
        Run(results, "uitk.uxml-unknown-action", "unity.uitk.uxml",
            Args(new object[] { "action", "frobnicate", "path", "Assets/UI/Test.uxml" }));

        // ---- USS ----
        Run(results, "uitk.uss-create", "unity.uitk.uss",
            Args(new object[] { "action", "create", "path", "Assets/UI/Test.uss",
                "content", ".dsh-button {\n    color: rgb(255, 0, 0);\n}\n" }));
        Run(results, "uitk.uss-read", "unity.uitk.uss",
            Args(new object[] { "action", "read", "path", "Assets/UI/Test.uss" }));
        Run(results, "uitk.uss-validate", "unity.uitk.uss",
            Args(new object[] { "action", "validate", "path", "Assets/UI/Test.uss" }));
        Run(results, "uitk.uss-validate-missing", "unity.uitk.uss",
            Args(new object[] { "action", "validate", "path", "Assets/UI/Nope.uss" }));
        Run(results, "uitk.uss-write", "unity.uitk.uss",
            Args(new object[] { "action", "write", "path", "Assets/UI/Test.uss",
                "content", ".dsh-button {\n    color: blue;\n}\n" }));
        Run(results, "uitk.uss-read-after-write", "unity.uitk.uss",
            Args(new object[] { "action", "read", "path", "Assets/UI/Test.uss" }));
        Run(results, "uitk.uss-create-exists", "unity.uitk.uss",
            Args(new object[] { "action", "create", "path", "Assets/UI/Test.uss", "content", "x" }));
        Run(results, "uitk.uss-absolute-path", "unity.uitk.uss",
            Args(new object[] { "action", "create", "path", "/tmp/uitk-evil.uss", "content", "x" }));
        Run(results, "uitk.uss-outside-assets", "unity.uitk.uss",
            Args(new object[] { "action", "create", "path", "Library/Test.uss", "content", "x" }));
        Run(results, "uitk.uss-bad-extension", "unity.uitk.uss",
            Args(new object[] { "action", "create", "path", "Assets/UI/NotUss.uxml", "content", "x" }));

        // ---- PanelSettings（反射主路径 + 缺失/越界路径）----
        var uitkPanelChanges = Dict(
            "scaleMode", "ScaleWithScreenSize",
            "screenMatchMode", "MatchWidthOrHeight",
            "referenceResolution", Dict("x", 1920L, "y", 1080L),
            "match", 0.5d,
            "sortOrder", 5L,
            "nonsense", "ignored-value");
        Run(results, "uitk.panel-list", "unity.uitk.panel_settings",
            Args(new object[] { "action", "list" }));
        Run(results, "uitk.panel-create", "unity.uitk.panel_settings",
            Args(new object[] { "action", "create", "path", "Assets/UI/TestPanel.asset", "changes", uitkPanelChanges }));
        Run(results, "uitk.panel-create-absolute", "unity.uitk.panel_settings",
            Args(new object[] { "action", "create", "path", "/tmp/TestPanel.asset" }));
        Run(results, "uitk.panel-create-bad-extension", "unity.uitk.panel_settings",
            Args(new object[] { "action", "create", "path", "Assets/UI/TestPanel.uxml" }));
        Run(results, "uitk.panel-create-missing-path", "unity.uitk.panel_settings",
            Args(new object[] { "action", "create" }));
        Run(results, "uitk.panel-create-theme-missing", "unity.uitk.panel_settings",
            Args(new object[] { "action", "create", "path", "Assets/UI/ThemePanel.asset",
                "changes", Dict("themeStyleSheet", "Assets/UI/Missing.tss") }));
        Run(results, "uitk.panel-get-missing", "unity.uitk.panel_settings",
            Args(new object[] { "action", "get", "path", "Assets/UI/Nope.asset" }));
        Run(results, "uitk.panel-set-missing", "unity.uitk.panel_settings",
            Args(new object[] { "action", "set", "path", "Assets/UI/Nope.asset", "changes", Dict("match", 0.1d) }));
        Run(results, "uitk.panel-unknown-action", "unity.uitk.panel_settings",
            Args(new object[] { "action", "frobnicate", "path", "Assets/UI/TestPanel.asset" }));

        // ---- UIDocument（离线场景没有对象：主路径 = list 空结果，其余断言错误码）----
        Run(results, "uitk.document-list", "unity.uitk.document",
            Args(new object[] { "action", "list" }));
        Run(results, "uitk.document-get-no-target", "unity.uitk.document",
            Args(new object[] { "action", "get" }));
        Run(results, "uitk.document-get-missing", "unity.uitk.document",
            Args(new object[] { "action", "get", "path", "NoSuchDoc" }));
        Run(results, "uitk.document-tree-missing", "unity.uitk.document",
            Args(new object[] { "action", "tree", "path", "NoSuchDoc" }));
        Run(results, "uitk.document-set-missing", "unity.uitk.document",
            Args(new object[] { "action", "set", "path", "NoSuchDoc", "sortingOrder", 3L }));
        Run(results, "uitk.document-create-missing-target", "unity.uitk.document",
            Args(new object[] { "action", "create" }));
        Run(results, "uitk.document-unknown-action", "unity.uitk.document",
            Args(new object[] { "action", "frobnicate", "path", "NoSuchDoc" }));
`;
