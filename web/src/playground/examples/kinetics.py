import matplotlib.pyplot as plt

states = ["Naive", "Memory", "Effector", "Cycling"]
control = [34, 48, 22, 12]
treated = [18, 37, 44, 29]
x = list(range(len(states)))

fig, ax = plt.subplots(figsize=(3.4, 2.5))
width = 0.34
ax.bar([i - width / 2 for i in x], control, width, label="Control")
ax.bar([i + width / 2 for i in x], treated, width, label="Treated")
ax.set_xlabel("Cell state")
ax.set_ylabel("Score (%)")
ax.set_title("Cell-state scores", fontsize=9)
ax.set_xticks(x, states)
ax.set_ylim(0, 60)
ax.legend(loc="upper right")
fig.tight_layout()
fig.savefig("kinetics.pdf")
