WITH shoplist AS (
    SELECT DISTINCT
        shop_id                                    -- VARCHAR in this table
    FROM phsbsbi_com.fbs_enrolled_shop_list
)
-- 1) Total PLATFORM ADO for the previous calendar month (month - 1)
,platform_prev_month AS (
    SELECT
        CAST(a.shop_id AS VARCHAR) AS shop_id
        ,SUM(COALESCE(a.order_fraction, 0)) AS total_orders_prev_month
        ,SUM(COALESCE(a.order_fraction, 0)) * 1.0
            / DATE_DIFF(
                'day'
                ,DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1' MONTH   -- 1st of prev month
                ,DATE_TRUNC('month', CURRENT_DATE)                        -- 1st of current month
              ) AS platform_ado_prev_month
    FROM mp_order.dwd_order_item_all_ent_df__ph_s0_live a
    WHERE
        DATE(FROM_UNIXTIME(a.create_timestamp))
            BETWEEN DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1' MONTH
                AND DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1' DAY
    GROUP BY 1
)
-- 3) D-1 PLATFORM ADO (divisor for the FBS rate)
,platform_d1 AS (
    SELECT
        CAST(a.shop_id AS VARCHAR) AS shop_id
        ,SUM(COALESCE(a.order_fraction, 0)) AS platform_ado_d1
    FROM mp_order.dwd_order_item_all_ent_df__ph_s0_live a
    WHERE
        DATE(FROM_UNIXTIME(a.create_timestamp)) = CURRENT_DATE - INTERVAL '1' DAY
    GROUP BY 1
)
-- 2) D-1 FBS ADO
,fbs_d1 AS (
    SELECT
        CAST(o.shop_id AS VARCHAR) AS shop_id
        ,SUM(COALESCE(o.order_fraction_mp, 0)) AS fbs_ado_d1
    FROM phbi_ops.sbs_order_item_mart_mp_sku_level o
    WHERE
        o.bu_tagging_l4 IN ('Local FBS - MP', 'Local FBS - Mall', 'CB LFF - MP')
        AND o.create_date = CURRENT_DATE - INTERVAL '1' DAY
    GROUP BY 1
)

SELECT
    s.shop_id
    ,COALESCE(pm.platform_ado_prev_month, 0) AS platform_ado_prev_month   -- 1
    ,COALESCE(f.fbs_ado_d1, 0)               AS fbs_ado_d1                 -- 2
    ,COALESCE(p1.platform_ado_d1, 0)         AS platform_ado_d1            -- 3 (divisor)
    ,CASE
        WHEN COALESCE(p1.platform_ado_d1, 0) = 0 THEN NULL
        ELSE COALESCE(f.fbs_ado_d1, 0) * 1.0 / p1.platform_ado_d1
     END AS fbs_rate_d1                                                    -- 4 (FBS ADO / Platform ADO)
FROM shoplist s
LEFT JOIN platform_prev_month pm ON pm.shop_id = s.shop_id
LEFT JOIN platform_d1         p1 ON p1.shop_id = s.shop_id
LEFT JOIN fbs_d1               f ON  f.shop_id = s.shop_id
;
