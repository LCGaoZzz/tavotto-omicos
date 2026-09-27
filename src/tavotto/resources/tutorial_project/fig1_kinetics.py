"""教程图 1：细胞状态评分趋势 + 图例（最典型的可编辑的图）。

在 OmicOS 图形工作台里进入这张图的图内编辑，可以直接点中标题、坐标轴标签、图例、
任意一条曲线，改字号 / 颜色 / 线宽或拖动位置。改动存成 override，本文件
一个字都不改。
"""

import matplotlib.pyplot as plt
import numpy as np
from paper_style import COL_1, PALETTE, save


def main():
    dose = np.linspace(0, 4, 9)
    control = np.array([12, 16, 20, 24, 27, 29, 30, 31, 31])
    treated = np.array([10, 14, 19, 26, 34, 41, 46, 49, 51])

    fig, ax = plt.subplots(figsize=(COL_1, COL_1 * 0.72))
    # 边距按图幅定死：轴标签、刻度、标题都落在 figsize 之内。默认边距下
    # 轴标签会伸到图幅外——磁盘上的 PDF 靠 bbox_inches="tight" 把它救回来，
    # 但按图幅出图的地方（编辑器、导出）就会把它裁掉。
    fig.subplots_adjust(left=0.19, right=0.96, bottom=0.21, top=0.89)
    ax.plot(dose, control, color=PALETTE[0], lw=1.0, marker="o", ms=2.8, label="Control")
    ax.plot(dose, treated, color=PALETTE[1], lw=1.0, marker="s", ms=2.8, label="Treated")
    ax.set_xlabel("Dose (a.u.)")
    ax.set_ylabel("Cell-state score (%)")
    ax.set_title("Cell-state response")
    ax.set_xlim(0, 4)
    ax.set_ylim(0, 60)
    ax.legend(loc="upper left")
    save(fig, "Fig1_kinetics")


if __name__ == "__main__":
    main()
